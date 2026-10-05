import {
	canonicalJson,
	GovernedActionError,
	redactForAudit,
	sha256Hex,
} from "./index.mjs";
import { boundRunPrincipal } from "./run-principal.mjs";

const ADMIN = new Set(["owner", "admin"]);
const ACTIVE_RUN = new Set(["RUNNING", "WAITING_FOR_APPROVAL"]);
const OPEN = new Set(["PENDING", "APPROVED"]);
const DECISIONS = new Set(["APPROVED", "REJECTED", "CANCELLED", "EXPIRED"]);
const fail = (code, message) => {
	throw new GovernedActionError(code, message, { sideEffect: "NOT_STARTED" });
};
const id = (value) => {
	if (
		typeof value !== "string" ||
		!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,511}$/.test(value)
	)
		fail("APPROVAL_INPUT_INVALID", "Invalid approval identifier");
	return value;
};
const hash = (value) => {
	if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
		fail("APPROVAL_INPUT_INVALID", "Invalid approval digest");
	return value;
};
const date = (value) => {
	const result = new Date(value);
	if (!Number.isFinite(result.getTime()))
		fail("APPROVAL_CLOCK_INVALID", "Invalid approval clock");
	return result;
};
const printable = (value) =>
	typeof value === "string"
		? // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject or sanitize control characters at this security boundary.
			value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 240)
		: "";
/** Durable one-shot consent. No public endpoint may call request with model-supplied authority. */
export function createPrismaApprovalLifecycle({
	prisma,
	workspaceId,
	clock = () => new Date(),
	ttlMs = 1800000,
} = {}) {
	id(workspaceId);
	if (
		!prisma?.$transaction ||
		!Number.isSafeInteger(ttlMs) ||
		ttlMs < 60000 ||
		ttlMs > 3600000
	)
		fail("APPROVAL_CONFIG_INVALID", "Invalid approval lifecycle configuration");
	const now = () => date(clock());
	function context(value) {
		if (value?.tenantId !== workspaceId)
			fail("APPROVAL_FORBIDDEN", "Approval workspace access is denied");
		return { tenantId: workspaceId, actorId: id(value.actorId) };
	}
	async function member(client, userId, admin = false) {
		const row = await client.member.findUnique({
			where: { organizationId_userId: { organizationId: workspaceId, userId } },
			select: { role: true },
		});
		if (
			!row ||
			!["owner", "admin", "member"].includes(row.role) ||
			(admin && !ADMIN.has(row.role))
		)
			fail("APPROVAL_FORBIDDEN", "Current workspace membership is required");
		return row;
	}
	async function requester(client, actorId, runId = null) {
		if (actorId.startsWith("agent-run:")) {
			if (!runId || actorId !== `agent-run:${runId}`)
				fail("APPROVAL_FORBIDDEN", "Agent identity is not bound to this run");
			const run = await client.agentRun.findUnique({
				where: { id: runId },
				select: {
					id: true,
					status: true,
					initiatedById: true,
					principalId: true,
					versionId: true,
					cancelRequestedAt: true,
				},
			});
			if (!run || !ACTIVE_RUN.has(run.status) || run.cancelRequestedAt)
				fail(
					"APPROVAL_RUN_INACTIVE",
					"The requesting agent run is no longer active",
				);
			const version = await client.agentVersion.findUnique({
				where: { id: run.versionId },
				select: { createdById: true, agentId: true },
			});
			if (!version)
				fail(
					"APPROVAL_RUN_INACTIVE",
					"The requesting immutable version is unavailable",
				);
			const agent = await client.agentDefinition.findUnique({
				where: { id: version.agentId },
				select: { status: true, createdById: true },
			});
			const humanId = boundRunPrincipal(run, agent);
			if (!humanId)
				fail(
					"APPROVAL_FORBIDDEN",
					"The original run principal is unavailable or inconsistent",
				);
			await member(client, humanId);
			if (!agent || !["LIVE", "PAUSED"].includes(agent.status))
				fail("APPROVAL_RUN_INACTIVE", "The agent is not a deployed team agent");
			return { humanId, runId };
		}
		if (runId)
			fail(
				"APPROVAL_FORBIDDEN",
				"Only a trusted agent-run identity may bind an agent run",
			);
		await member(client, actorId);
		return { humanId: actorId, runId: null };
	}
	async function transaction(callback) {
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				return await prisma.$transaction(callback, {
					isolationLevel: "Serializable",
					maxWait: 5000,
					timeout: 10000,
				});
			} catch (error) {
				if (!["P2034", "P2002"].includes(error?.code) || attempt === 2)
					throw error;
			}
		}
	}
	async function audit(client, row, actorId, type, at, details = {}) {
		await client.governedActionAuditEvent.create({
			data: {
				workspaceId,
				actionId: row.actionId,
				actorId,
				requestId: row.requestId,
				correlationId: row.correlationId,
				eventType: type,
				payloadDigest: row.payloadDigest,
				detailsJson: { approvalId: row.id, version: row.version, ...details },
				occurredAt: at,
			},
		});
	}
	async function get(client, approvalId) {
		const row = await client.governedActionApproval.findFirst({
			where: { id: id(approvalId), workspaceId },
		});
		if (!row)
			fail("APPROVAL_NOT_FOUND", "Approval is not available in this workspace");
		return row;
	}
	function view(row, actorId, at) {
		const effectiveStatus =
			OPEN.has(row.status) && row.expiresAt <= at ? "EXPIRED" : row.status;
		const bound =
			row.bindingVersion === 1 &&
			row.snapshotJson?.source === "GOVERNED_EXECUTOR";
		return {
			id: row.id,
			actionId: row.actionId,
			payloadDigest: row.payloadDigest,
			status: effectiveStatus,
			persistedStatus: row.status,
			version: row.version,
			requestedById: row.requestedById,
			requesterUserId: row.requesterUserId ?? null,
			runId: row.runId ?? null,
			createdAt: date(row.createdAt).toISOString(),
			expiresAt: date(row.expiresAt).toISOString(),
			decidedAt: row.decidedAt ? date(row.decidedAt).toISOString() : null,
			decidedById: row.decidedById ?? null,
			decisionReason: row.decisionReason ?? null,
			snapshot: bound ? row.snapshotJson : null,
			legacyUnbound: !bound,
			canApprove:
				bound &&
				effectiveStatus === "PENDING" &&
				row.snapshotJson.previewComplete === true &&
				actorId !== row.requestedById &&
				actorId !== row.requesterUserId,
			canReject: bound && effectiveStatus === "PENDING",
			canCancel: bound && OPEN.has(effectiveStatus),
			// Approval is permission for the same action identity, never a command to restart a run.
			startsExecution: false,
		};
	}
	return Object.freeze({
		async request({
			context: trusted,
			actionId,
			digest,
			manifestVersion,
			title,
			risk,
			mutating,
			executionKey,
			input,
		}) {
			const c = context(trusted);
			id(actionId);
			hash(digest);
			id(manifestVersion);
			id(trusted.requestId);
			id(trusted.correlationId ?? trusted.requestId);
			if (
				typeof executionKey !== "string" ||
				!executionKey ||
				executionKey.length > 512
			)
				fail("APPROVAL_INPUT_INVALID", "Stable execution identity is required");
			if (
				!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(risk) ||
				typeof mutating !== "boolean"
			)
				fail("APPROVAL_INPUT_INVALID", "Invalid action manifest");
			const sourceInput = JSON.parse(canonicalJson(input));
			const actualDigest = sha256Hex({
				tenantId: workspaceId,
				actionId,
				manifestVersion,
				input: sourceInput,
			});
			if (actualDigest !== digest)
				fail(
					"APPROVAL_DIGEST_MISMATCH",
					"Approval digest does not match the validated action",
				);
			const preview = redactForAudit(sourceInput);
			const snapshot = {
				source: "GOVERNED_EXECUTOR",
				title: printable(title) || actionId,
				manifestVersion,
				risk,
				mutating,
				inputSha256: sha256Hex(sourceInput),
				preview,
				previewComplete: canonicalJson(preview) === canonicalJson(sourceInput),
			};
			if (Buffer.byteLength(canonicalJson(snapshot), "utf8") > 32768)
				fail(
					"APPROVAL_PREVIEW_LIMIT",
					"Action needs a bounded dedicated approval preview",
				);
			const executionKeyHash = sha256Hex(executionKey);
			const requestKey = sha256Hex([
				workspaceId,
				c.actorId,
				actionId,
				executionKeyHash,
			]);
			const approvalId = `ga_${requestKey.slice(0, 48)}`;
			const runId = c.actorId.startsWith("agent-run:")
				? id(sourceInput.runId)
				: null;
			return transaction(async (client) => {
				const principal = await requester(client, c.actorId, runId);
				const old = await client.governedActionApproval.findFirst({
					where: { id: approvalId, workspaceId },
				});
				if (old) {
					if (
						old.bindingVersion !== 1 ||
						old.payloadDigest !== digest ||
						old.requestedById !== c.actorId ||
						old.requesterUserId !== principal.humanId ||
						old.executionKeyHash !== executionKeyHash
					)
						fail(
							"APPROVAL_KEY_REUSED",
							"Approval execution identity was reused with different authority or payload",
						);
					return view(old, c.actorId, now());
				}
				const at = now();
				const pending = await client.governedActionApproval.count({
					where: {
						workspaceId,
						requestedById: c.actorId,
						status: "PENDING",
						expiresAt: { gt: at },
					},
				});
				if (pending >= 50)
					fail(
						"APPROVAL_QUEUE_LIMIT",
						"Pending approval limit reached for this requester",
					);
				const row = await client.governedActionApproval.create({
					data: {
						id: approvalId,
						workspaceId,
						actionId,
						payloadDigest: digest,
						status: "PENDING",
						requestedById: c.actorId,
						requesterUserId: principal.humanId,
						runId,
						bindingVersion: 1,
						requestKey,
						executionKeyHash,
						requestId: trusted.requestId,
						correlationId: trusted.correlationId ?? trusted.requestId,
						manifestVersion,
						snapshotJson: snapshot,
						version: 0,
						approvedById: null,
						consumedById: null,
						consumedAt: null,
						expiresAt: new Date(at.getTime() + ttlMs),
						createdAt: at,
						updatedAt: at,
					},
				});
				await audit(client, row, c.actorId, "agent.approval.requested", at, {
					risk,
					manifestVersion,
					previewComplete: snapshot.previewComplete,
				});
				return view(row, c.actorId, at);
			});
		},
		async list(inputContext, { status = "ALL", before = null } = {}) {
			const c = context(inputContext);
			await member(prisma, c.actorId, true);
			const statuses = [
				"ALL",
				"PENDING",
				"APPROVED",
				"REJECTED",
				"EXPIRED",
				"CANCELLED",
				"CONSUMED",
			];
			if (!statuses.includes(status))
				fail("APPROVAL_INPUT_INVALID", "Invalid approval filter");
			const at = now();
			// Cursor is a stable (createdAt,id) pair, not an offset that skips concurrent inserts.
			let cursor = {};
			if (before) {
				const timestamp = date(before.createdAt);
				id(before.id);
				cursor = {
					OR: [
						{ createdAt: { lt: timestamp } },
						{ createdAt: timestamp, id: { lt: before.id } },
					],
				};
			}
			const state =
				status === "ALL"
					? {}
					: status === "EXPIRED"
						? {
								OR: [
									{ status: "EXPIRED" },
									{
										status: { in: ["PENDING", "APPROVED"] },
										expiresAt: { lte: at },
									},
								],
							}
						: OPEN.has(status)
							? { status, expiresAt: { gt: at } }
							: { status };
			const rows = await prisma.governedActionApproval.findMany({
				where: { workspaceId, AND: [state, cursor] },
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				take: 51,
			});
			const page = rows.slice(0, 50);
			return {
				items: page.map((row) => view(row, c.actorId, at)),
				next:
					rows.length > 50
						? {
								createdAt: date(page.at(-1).createdAt).toISOString(),
								id: page.at(-1).id,
							}
						: null,
				at: at.toISOString(),
			};
		},
		async decide(
			inputContext,
			{ approvalId, expectedVersion, expectedDigest, decision, reason = "" },
		) {
			const c = context(inputContext);
			id(approvalId);
			hash(expectedDigest);
			if (
				!Number.isSafeInteger(expectedVersion) ||
				expectedVersion < 0 ||
				!DECISIONS.has(decision) ||
				typeof reason !== "string" ||
				reason.length > 500
			)
				fail("APPROVAL_INPUT_INVALID", "Invalid approval decision");
			// Reasons are operator text. Never persist likely credentials in an audit field.
			const safeReason = String(redactForAudit(reason)).slice(0, 500);
			return transaction(async (client) => {
				await member(client, c.actorId, true);
				const row = await get(client, approvalId);
				let at = now();
				if (
					row.bindingVersion !== 1 ||
					row.snapshotJson?.source !== "GOVERNED_EXECUTOR"
				)
					fail(
						"APPROVAL_UNBOUND",
						"Legacy consent has no verified snapshot; request it again through the governed executor",
					);
				if (row.payloadDigest !== expectedDigest)
					fail("APPROVAL_DIGEST_MISMATCH", "The action preview changed");
				if (
					row.status === decision &&
					row.decidedById === c.actorId &&
					row.decisionReason === safeReason
				)
					return view(row, c.actorId, at);
				if (row.version !== expectedVersion)
					fail("APPROVAL_STALE", "Refresh the action before deciding");
				if (!OPEN.has(row.status))
					fail("APPROVAL_TERMINAL", "Approval already has a terminal decision");
				let next = row.expiresAt <= at ? "EXPIRED" : decision;
				if (next === "EXPIRED" && row.expiresAt > at)
					fail("APPROVAL_NOT_EXPIRED", "Approval has not expired");
				if (next === "APPROVED") {
					if (row.status !== "PENDING")
						fail("APPROVAL_TERMINAL", "Approval is already decided");
					if (
						c.actorId === row.requestedById ||
						c.actorId === row.requesterUserId
					)
						fail(
							"APPROVAL_SELF_DECISION",
							"A different workspace administrator must approve this action",
						);
					if (row.snapshotJson.previewComplete !== true)
						fail(
							"APPROVAL_PREVIEW_INCOMPLETE",
							"This action needs a complete safe preview before it can be approved",
						);
					const current = await requester(client, row.requestedById, row.runId);
					if (current.humanId !== row.requesterUserId)
						fail(
							"APPROVAL_PRINCIPAL_CHANGED",
							"Requesting principal changed; request new consent",
						);
				}
				if (next === "REJECTED" && row.status !== "PENDING")
					fail(
						"APPROVAL_TERMINAL",
						"Use cancellation to revoke unconsumed approved consent",
					);
				// Authority reads can cross the deadline while waiting on PostgreSQL.
				// Recheck using the service clock immediately before the compare-and-swap.
				at = now();
				if (row.expiresAt <= at) next = "EXPIRED";
				const change = {
					status: next,
					approvedById: next === "APPROVED" ? c.actorId : row.approvedById,
					decidedById: c.actorId,
					decidedAt: at,
					decisionReason: safeReason,
					updatedAt: at,
					version: { increment: 1 },
				};
				const updated = await client.governedActionApproval.updateMany({
					where: {
						id: row.id,
						workspaceId,
						version: row.version,
						status: row.status,
						payloadDigest: expectedDigest,
						consumedAt: null,
					},
					data: change,
				});
				if (updated.count !== 1)
					fail("APPROVAL_STALE", "Approval changed concurrently");
				const result = { ...row, ...change, version: row.version + 1 };
				await audit(
					client,
					result,
					c.actorId,
					`agent.approval.${next.toLowerCase()}`,
					at,
					{ previousStatus: row.status },
				);
				return view(result, c.actorId, at);
			});
		},
		async consume({
			approvalId,
			tenantId,
			actionId,
			digest,
			actorId,
			executionKey,
			now: requestedNow,
		}) {
			context({ tenantId, actorId });
			id(approvalId);
			id(actionId);
			hash(digest);
			if (
				typeof executionKey !== "string" ||
				!executionKey ||
				executionKey.length > 512
			)
				return null;
			if (requestedNow !== undefined) date(requestedNow); // validate, never trust a supplied timestamp for expiry
			return transaction(async (client) => {
				let at = now();
				const row = await client.governedActionApproval.findFirst({
					where: {
						id: approvalId,
						workspaceId,
						actionId,
						payloadDigest: digest,
						bindingVersion: 1,
						requestedById: actorId,
						executionKeyHash: sha256Hex(executionKey),
						status: "APPROVED",
						consumedAt: null,
						expiresAt: { gt: at },
					},
				});
				if (
					!row ||
					row.snapshotJson?.previewComplete !== true ||
					!row.approvedById ||
					row.approvedById === actorId ||
					row.approvedById === row.requesterUserId
				)
					return null;
				const current = await requester(client, actorId, row.runId);
				if (current.humanId !== row.requesterUserId) return null;
				await member(client, row.approvedById, true); // revoked human authority invalidates unused consent
				at = now();
				if (row.expiresAt <= at) return null;
				const updated = await client.governedActionApproval.updateMany({
					where: {
						id: row.id,
						workspaceId,
						status: "APPROVED",
						version: row.version,
						consumedAt: null,
						expiresAt: { gt: at },
					},
					data: {
						status: "CONSUMED",
						consumedAt: at,
						consumedById: actorId,
						updatedAt: at,
						version: { increment: 1 },
					},
				});
				if (updated.count !== 1) return null;
				await audit(
					client,
					{ ...row, version: row.version + 1 },
					actorId,
					"agent.approval.consumed",
					at,
				);
				return { consumed: true, tenantId, actionId, digest };
			});
		},
	});
}
