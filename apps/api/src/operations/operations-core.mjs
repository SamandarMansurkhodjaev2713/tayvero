import {
	createPrismaApprovalLifecycle,
	GovernedActionError,
} from "@crm/agent-action-runtime";

const LIMIT = 5000;
const fail = (code, message) => {
	const error = new Error(message);
	error.code = code;
	throw error;
};
function usdMicros(value) {
	if (value == null) return null;
	const text = String(value);
	const match = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(text);
	if (!match) return null;
	return BigInt(match[1]) * 1000000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}
function decimal(micros) {
	return `${micros / 1000000n}.${String(micros % 1000000n).padStart(6, "0")}`;
}
function timestamp(value) {
	return value ? new Date(value).toISOString() : null;
}
function safeCode(value) {
	return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,95}$/.test(value)
		? value
		: null;
}
/** The CRM action requestHash is NOT the governed receipt digest.
 * Only the server-written operationDigest in action metadata is a valid bridge.
 * Never expose the metadata itself to the operations client.
 */
export function governedReceiptDigest(action) {
	const value = action?.metadata;
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, "operationDigest");
	return descriptor &&
		"value" in descriptor &&
		typeof descriptor.value === "string" &&
		/^[a-f0-9]{64}$/.test(descriptor.value)
		? descriptor.value
		: null;
}
export function summarizeRunWindow(rows, total) {
	const complete = rows.length === total && total <= LIMIT;
	let cost = 0n,
		known = 0;
	for (const row of rows) {
		const amount = usdMicros(row.costUsd);
		if (amount !== null) {
			cost += amount;
			known++;
		}
	}
	const counts = Object.fromEntries(
		[
			"QUEUED",
			"RUNNING",
			"WAITING_FOR_APPROVAL",
			"SUCCEEDED",
			"FAILED",
			"CANCELLED",
		].map((status) => [
			status,
			rows.filter((row) => row.status === status).length,
		]),
	);
	const denominator = counts.SUCCEEDED + counts.FAILED;
	return {
		runCount: total,
		complete,
		counts: complete ? counts : null,
		successRatePercent:
			complete && denominator > 0
				? Math.round((counts.SUCCEEDED * 10000) / denominator) / 100
				: null,
		recordedAiCostUsd: complete && known ? decimal(cost) : null,
		runsWithRecordedCost: complete ? known : null,
		runsWithoutRecordedCost: complete ? total - known : null,
		outcomeValue: null,
		validatedTimeSaved: null,
		costMeaning: "SUM_OF_RECORDED_RUN_COSTS_USD_NOT_TOTAL_BUSINESS_COST",
		successMeaning:
			"SUCCEEDED_DIVIDED_BY_SUCCEEDED_PLUS_FAILED_NOT_BUSINESS_ROI",
	};
}
/** Team operations only. Does not broaden private-draft visibility or claim shared tenancy. */
export function createAgentOperations({
	prisma,
	workspaceId,
	clock = () => new Date(),
	approvalsEnabled = false,
	continuationsEnabled = false,
}) {
	const approvals = createPrismaApprovalLifecycle({
		prisma,
		workspaceId,
		clock,
	});
	function context(value) {
		if (
			value?.tenantId !== workspaceId ||
			typeof value.actorId !== "string" ||
			!value.actorId
		)
			fail("OPERATIONS_FORBIDDEN", "Invalid workspace context");
		return { tenantId: workspaceId, actorId: value.actorId };
	}
	async function admin(client, c) {
		const membership = await client.member.findUnique({
			where: {
				organizationId_userId: {
					organizationId: workspaceId,
					userId: c.actorId,
				},
			},
			select: { role: true },
		});
		if (!membership || !["owner", "admin"].includes(membership.role))
			fail(
				"OPERATIONS_FORBIDDEN",
				"Current workspace administrator membership is required",
			);
	}
	return Object.freeze({
		async capabilities(value) {
			const c = context(value);
			await admin(prisma, c);
			return {
				approvalsEnabled,
				continuationsEnabled,
				dedicatedWorkspace: true,
				businessOutcomesInstrumented: false,
				liveProviderHealthVerified: false,
				scope: "DEPLOYED_TEAM_AGENTS_ONLY",
				rowLimit: LIMIT,
			};
		},
		async overview(value, { hours = 24 } = {}) {
			const c = context(value);
			if (![24, 168].includes(hours))
				fail("OPERATIONS_INPUT_INVALID", "Choose the last 24 hours or 7 days");
			return prisma.$transaction(
				async (client) => {
					await admin(client, c);
					const at = new Date(clock());
					if (!Number.isFinite(at.getTime()))
						fail("OPERATIONS_CLOCK_INVALID", "Invalid clock");
					const from = new Date(at.getTime() - hours * 3600000);
					const agents = await client.agentDefinition.findMany({
						where: {
							status: { in: ["LIVE", "PAUSED", "ARCHIVED"] },
							deletedAt: null,
						},
						select: { id: true, name: true, status: true, updatedAt: true },
						orderBy: { id: "asc" },
						take: 1001,
					});
					if (agents.length > 1000)
						fail(
							"OPERATIONS_LIMIT",
							"This deployment exceeds the bounded operations view; add an aggregated query before increasing the limit",
						);
					const agentIds = agents.map((row) => row.id);
					const filter = {
						agentId: { in: agentIds },
						createdAt: { gte: from, lte: at },
					};
					const total = await client.agentRun.count({ where: filter });
					const runs = await client.agentRun.findMany({
						where: filter,
						orderBy: [{ createdAt: "desc" }, { id: "desc" }],
						take: LIMIT + 1,
						select: {
							id: true,
							agentId: true,
							versionId: true,
							status: true,
							costUsd: true,
							createdAt: true,
							startedAt: true,
							finishedAt: true,
							errorCode: true,
						},
					});
					const actionFilter = {
						agentId: { in: agentIds },
						plannedAt: { gte: from, lte: at },
					};
					const actionCount = await client.agentAction.count({
						where: actionFilter,
					});
					const actions = await client.agentAction.findMany({
						where: actionFilter,
						orderBy: [{ plannedAt: "desc" }, { id: "desc" }],
						take: LIMIT + 1,
						select: {
							id: true,
							agentId: true,
							runId: true,
							type: true,
							provider: true,
							targetType: true,
							targetId: true,
							status: true,
							metadata: true,
							attemptCount: true,
							plannedAt: true,
							completedAt: true,
							errorCode: true,
						},
					});
					const hashes = [
						...new Set(actions.map(governedReceiptDigest).filter(Boolean)),
					];
					// Both the immutable operation digest and action kind must agree. Older actions
					// without this persisted bridge are explicitly not treated as fully reconciled.
					const receipts = hashes.length
						? await client.governedActionReceipt.findMany({
								where: {
									workspaceId,
									payloadDigest: { in: hashes },
									status: "AMBIGUOUS",
								},
								select: {
									id: true,
									actionId: true,
									payloadDigest: true,
									errorCode: true,
								},
								take: LIMIT + 1,
							})
						: [];
					const receiptKey = (kind, digest) => `${kind}:${digest}`;
					const uncertain = new Map(
						receipts.map((row) => [
							receiptKey(row.actionId, row.payloadDigest),
							row,
						]),
					);
					const receiptFor = (action) =>
						uncertain.get(
							receiptKey(action.type, governedReceiptDigest(action)),
						);
					const receiptCoverageComplete =
						receipts.length <= LIMIT &&
						actions.every((action) => governedReceiptDigest(action) !== null);
					const names = new Map(agents.map((row) => [row.id, row.name]));
					const recentActions = actions.slice(0, 50).map((row) => ({
						id: row.id,
						agentId: row.agentId,
						agentName: names.get(row.agentId) ?? row.agentId,
						runId: row.runId,
						type: row.type,
						provider: row.provider,
						targetType: row.targetType,
						targetId: row.targetId,
						status: row.status,
						attemptCount: row.attemptCount,
						errorCode: safeCode(row.errorCode),
						plannedAt: timestamp(row.plannedAt),
						completedAt: timestamp(row.completedAt),
						reconciliationRequired: Boolean(receiptFor(row)),
					}));
					const incidentActions = actions.filter(
						(row) => row.status === "FAILED" || Boolean(receiptFor(row)),
					);
					const incidents = incidentActions.slice(0, 50).map((row) => ({
						actionId: row.id,
						runId: row.runId,
						agentId: row.agentId,
						agentName: names.get(row.agentId) ?? row.agentId,
						type: Boolean(receiptFor(row))
							? "AMBIGUOUS_OUTCOME"
							: "ACTION_FAILED",
						errorCode: safeCode(receiptFor(row)?.errorCode ?? row.errorCode),
						at: timestamp(row.completedAt ?? row.plannedAt),
						safeToAutomaticallyRetry: false,
					}));
					const pendingApprovals = approvalsEnabled
						? await client.governedActionApproval.count({
								where: {
									workspaceId,
									bindingVersion: 1,
									status: "PENDING",
									expiresAt: { gt: at },
								},
							})
						: null;
					return {
						window: { from: from.toISOString(), to: at.toISOString(), hours },
						metrics: {
							...summarizeRunWindow(runs, total),
							activeAgents: agents.filter((row) => row.status === "LIVE")
								.length,
							pendingApprovals,
							actionCount,
							actionCoverageComplete:
								actionCount === actions.length && actionCount <= LIMIT,
							incidentCount:
								actionCount <= LIMIT && receiptCoverageComplete
									? incidentActions.length
									: null,
						},
						agents: agents.map((row) => ({
							...row,
							updatedAt: timestamp(row.updatedAt),
						})),
						runs: runs.slice(0, 50).map((row) => ({
							id: row.id,
							agentId: row.agentId,
							agentName: names.get(row.agentId) ?? row.agentId,
							versionId: row.versionId,
							status: row.status,
							costUsd:
								usdMicros(row.costUsd) === null
									? null
									: decimal(usdMicros(row.costUsd)),
							createdAt: timestamp(row.createdAt),
							startedAt: timestamp(row.startedAt),
							finishedAt: timestamp(row.finishedAt),
							errorCode: safeCode(row.errorCode),
						})),
						actions: recentActions,
						incidents,
						displayedRowLimit: 50,
						incidentMeaning:
							"VISIBLE_ACTION_FAILURES_AND_MATCHED_AMBIGUOUS_RECEIPTS_NOT_ALL_PROVIDER_INCIDENTS",
						health: {
							readAt: at.toISOString(),
							liveProvidersVerified: false,
							outcomeLedgerImplemented: false,
							dataSource: "DEDICATED_WORKSPACE_DATABASE",
							windowLimited: total > LIMIT || actionCount > LIMIT,
							receiptCorrelationComplete: receiptCoverageComplete,
							actionsWithoutReceiptLink: actions.filter(
								(row) => !governedReceiptDigest(row),
							).length,
						},
					};
				},
				{ isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 15000 },
			);
		},
		async continuations(value, { status = "ACTIVE", before = null } = {}) {
			const c = context(value);
			if (!["ACTIVE", "ATTENTION", "ALL"].includes(status))
				fail("OPERATIONS_INPUT_INVALID", "Invalid continuation filter");
			return prisma.$transaction(
				async (client) => {
					await admin(client, c);
					if (!continuationsEnabled)
						fail(
							"OPERATIONS_NOT_CONFIGURED",
							"Native approval continuation is disabled",
						);
					let cursor = {};
					if (before) {
						const at = new Date(before.createdAt);
						if (
							!Number.isFinite(at.getTime()) ||
							typeof before.id !== "string" ||
							!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/.test(before.id)
						)
							fail("OPERATIONS_INPUT_INVALID", "Invalid continuation cursor");
						cursor = {
							OR: [
								{ createdAt: { lt: at } },
								{ createdAt: at, id: { lt: before.id } },
							],
						};
					}
					const state =
						status === "ALL"
							? {}
							: status === "ATTENTION"
								? { status: "RECONCILIATION_REQUIRED" }
								: {
										OR: [
											{
												status: {
													in: [
														"PREPARED",
														"BOUND",
														"READY",
														"DISPATCHING",
														"RECONCILIATION_REQUIRED",
													],
												},
											},
											{ status: "DELIVERED", decision: "approve" },
										],
									};
					const rows = await client.governedActionContinuation.findMany({
						where: { workspaceId, AND: [state, cursor] },
						orderBy: [{ createdAt: "desc" }, { id: "desc" }],
						take: 51,
						select: {
							id: true,
							approvalId: true,
							runId: true,
							callId: true,
							toolName: true,
							status: true,
							decision: true,
							errorCode: true,
							createdAt: true,
							waitingAt: true,
							deliveredAt: true,
							completedAt: true,
							updatedAt: true,
						},
					});
					const page = rows.slice(0, 50);
					return {
						items: page.map((row) => ({
							id: row.id,
							approvalId: row.approvalId,
							runId: row.runId,
							callId: row.callId,
							toolName: row.toolName,
							status: row.status,
							decision: row.decision,
							errorCode: safeCode(row.errorCode),
							createdAt: timestamp(row.createdAt),
							waitingAt: timestamp(row.waitingAt),
							deliveredAt: timestamp(row.deliveredAt),
							completedAt: timestamp(row.completedAt),
							updatedAt: timestamp(row.updatedAt),
							safeToAutomaticallyRetry: false,
						})),
						next:
							rows.length > 50
								? {
										createdAt: timestamp(page.at(-1).createdAt),
										id: page.at(-1).id,
									}
								: null,
						at: new Date(clock()).toISOString(),
						backgroundScheduleVerified: false,
					};
				},
				{ isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 15000 },
			);
		},
		async approvals(value, input) {
			const c = context(value);
			await admin(prisma, c);
			if (!approvalsEnabled)
				fail(
					"OPERATIONS_NOT_CONFIGURED",
					"Approval Center needs its database gate and deployment flag",
				);
			return approvals.list(c, input);
		},
		async decide(value, input) {
			const c = context(value);
			await admin(prisma, c);
			if (!approvalsEnabled)
				fail("OPERATIONS_NOT_CONFIGURED", "Approval Center is disabled");
			return approvals.decide(c, input);
		},
	});
}
export function publicOperationsError(error) {
	if (
		[
			"OPERATIONS_FORBIDDEN",
			"APPROVAL_FORBIDDEN",
			"APPROVAL_SELF_DECISION",
		].includes(error?.code)
	)
		return {
			status: 403,
			message:
				"A current workspace administrator is required. A requester cannot approve their own action.",
		};
	if (error?.code === "APPROVAL_NOT_FOUND")
		return {
			status: 404,
			message: "This approval is unavailable in your workspace.",
		};
	if (
		[
			"OPERATIONS_NOT_CONFIGURED",
			"APPROVAL_UNBOUND",
			"APPROVAL_PREVIEW_INCOMPLETE",
		].includes(error?.code)
	)
		return {
			status: 412,
			message:
				"This action needs a verified complete preview or deployment setup before approval. It has not been executed.",
		};
	if (
		[
			"APPROVAL_STALE",
			"APPROVAL_TERMINAL",
			"APPROVAL_RUN_INACTIVE",
			"APPROVAL_PRINCIPAL_CHANGED",
		].includes(error?.code)
	)
		return {
			status: 409,
			message:
				"The action or its authority changed. Refresh the queue. No new action was executed.",
		};
	if (
		error instanceof GovernedActionError ||
		["OPERATIONS_INPUT_INVALID", "OPERATIONS_LIMIT"].includes(error?.code)
	)
		return {
			status: 400,
			message:
				"The request could not be validated. Refresh and review the saved action state.",
		};
	return {
		status: 500,
		message:
			"Operations data could not be loaded or updated. This does not mean there are no failures. Refresh before retrying.",
	};
}
