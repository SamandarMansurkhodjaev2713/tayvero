const LEASE_MS = 180000;
const PERMANENT = new Set([
	"FORBIDDEN",
	"OWNER_NOT_MEMBER",
	"PLAN_CHANGED",
	"PLAN_VERSION",
	"SOURCE_CHANGED",
	"SOURCE_NOT_FOUND",
	"SOURCE_INTEGRITY",
	"SOURCE_KEY_UNAVAILABLE",
	"LEGACY_JOB",
	"NOT_FOUND",
	"EXECUTION_DISABLED",
	"NOT_CONFIGURED",
]);
const TRANSIENT = new Set([
	"P1001",
	"P1002",
	"P1008",
	"P1017",
	"P2024",
	"P2034",
	"TRANSACTION_RETRY_EXHAUSTED",
	"STALE_JOB",
	"LEASE_LOST",
]);
export function assertBackgroundClaim(row, claim, now, fail) {
	if (
		!row.backgroundEnabled ||
		row.backgroundVersion !== claim.version ||
		row.backgroundRequestedById !== claim.actorId ||
		!row.backgroundNextAttemptAt ||
		new Date(row.backgroundNextAttemptAt).getTime() <= now.getTime()
	)
		fail(
			"BACKGROUND_PAUSED",
			"Background execution consent or its lease changed",
		);
}
/** Persisted opt-in queue; the existing coordinator remains the only batch execution engine. */
export function createBackgroundImport({
	db,
	workspaceId,
	context,
	authorize,
	tx,
	job,
	event,
	time,
	configured,
	fail,
	executeBatch,
	enabled,
}) {
	async function audit(client, row, type, details = {}) {
		await client.crmMigrationEvent.create({
			data: {
				workspaceId,
				jobId: row.id,
				actorId: "migration-worker",
				type,
				details: { requestedById: row.backgroundRequestedById, ...details },
				createdAt: time(),
			},
		});
	}
	async function settle(claim, outcome, error = null) {
		// System worker may revoke scheduling after user rights disappear, never grant rights or write CRM data.
		return db.$transaction(
			async (client) => {
				const row = await client.crmMigrationJob.findFirst({
					where: { id: claim.jobId, workspaceId },
				});
				if (
					!row ||
					!row.backgroundEnabled ||
					row.backgroundVersion !== claim.version
				)
					return { acknowledged: false };
				const terminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(
					row.status,
				);
				const failureCount =
					(row.backgroundFailureCount ?? 0) + (error ? 1 : 0);
				const knownTransient = TRANSIENT.has(error?.code);
				const stopped =
					terminal ||
					(!!error &&
						(!knownTransient ||
							PERMANENT.has(error?.code) ||
							failureCount >= 5));
				const code = error
					? knownTransient || PERMANENT.has(error.code)
						? error.code
						: "WORKER_REVIEW_REQUIRED"
					: null;
				const next = stopped
					? null
					: new Date(
							time().getTime() +
								(error
									? Math.min(300000, 5000 * 2 ** (failureCount - 1))
									: outcome?.busy
										? 5000
										: 1000),
						);
				const saved = await client.crmMigrationJob.updateMany({
					where: {
						id: row.id,
						workspaceId,
						backgroundEnabled: true,
						backgroundVersion: claim.version,
					},
					data: {
						backgroundEnabled: !stopped,
						backgroundNextAttemptAt: next,
						backgroundVersion: { increment: 1 },
						backgroundFailureCount: error ? failureCount : 0,
						backgroundLastErrorCode: code,
					},
				});
				if (saved.count !== 1) return { acknowledged: false };
				await audit(
					client,
					row,
					stopped
						? "migration.background.stopped"
						: error
							? "migration.background.retry"
							: "migration.background.progress",
					{ code, status: row.status, failureCount: error ? failureCount : 0 },
				);
				return {
					acknowledged: true,
					state: stopped ? "STOPPED" : "SCHEDULED",
					code,
				};
			},
			{ isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 },
		);
	}
	return Object.freeze({
		async configure(inputContext, { jobId, enabled: requested, confirmation }) {
			const c = context(inputContext);
			await authorize(db, c);
			configured(requested);
			if (typeof requested !== "boolean")
				fail("INVALID_INPUT", "Background consent must be explicit");
			if (requested && !enabled)
				fail(
					"BACKGROUND_DISABLED",
					"Background worker is not enabled by deployment",
				);
			if (requested && confirmation !== jobId)
				fail("CONFIRMATION_REQUIRED", "Confirm the exact prepared import job");
			return tx(c, async (client) => {
				const row = await job(client, c, jobId);
				if (requested && !["READY", "IMPORTING"].includes(row.status))
					fail("JOB_TERMINAL", "Only ready or importing jobs can be scheduled");
				if (requested) {
					const owner = await client.member.findFirst({
						where: { organizationId: c.tenantId, userId: row.createdById },
					});
					if (!owner)
						fail(
							"OWNER_NOT_MEMBER",
							"The planned record owner is no longer a member",
						);
				}
				// Same exact consent is an idempotent no-op, not a fresh lease or retry budget.
				if (
					row.backgroundEnabled === requested &&
					(!requested || row.backgroundRequestedById === c.actorId)
				)
					return { jobId, enabled: requested, version: row.backgroundVersion };
				const changed = await client.crmMigrationJob.updateMany({
					where: { workspaceId: c.tenantId, id: jobId, version: row.version },
					data: {
						backgroundEnabled: requested,
						backgroundRequestedById: requested
							? c.actorId
							: row.backgroundRequestedById,
						backgroundVersion: { increment: 1 },
						backgroundNextAttemptAt: requested ? time() : null,
						backgroundFailureCount: 0,
						backgroundLastErrorCode: null,
					},
				});
				if (changed.count !== 1)
					fail("STALE_JOB", "Job changed while saving background consent");
				await event(
					client,
					c,
					jobId,
					requested
						? "migration.background.enabled"
						: "migration.background.paused",
					{},
				);
				return {
					jobId,
					enabled: requested,
					version: row.backgroundVersion + 1,
				};
			});
		},
		/** Internal worker capability. Deliberately NOT exposed as a public tRPC route. */
		async runOnce({ limit = 5, signal } = {}) {
			configured(true);
			if (!enabled)
				fail("BACKGROUND_DISABLED", "Background worker is disabled");
			if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10)
				fail("INVALID_INPUT", "Worker limit must be 1..10");
			const rows = await db.crmMigrationJob.findMany({
				where: {
					workspaceId,
					backgroundEnabled: true,
					OR: [
						{ backgroundNextAttemptAt: null },
						{ backgroundNextAttemptAt: { lte: time() } },
					],
				},
				orderBy: [{ backgroundNextAttemptAt: "asc" }, { id: "asc" }],
				take: limit,
			});
			const results = [];
			for (const candidate of rows) {
				if (signal?.aborted) break;
				let claim;
				try {
					const c = context({
						tenantId: workspaceId,
						actorId: candidate.backgroundRequestedById,
					});
					claim = await tx(c, async (client) => {
						const row = await job(client, c, candidate.id);
						if (
							!row.backgroundEnabled ||
							row.backgroundVersion !== candidate.backgroundVersion ||
							(row.backgroundNextAttemptAt &&
								new Date(row.backgroundNextAttemptAt) > time())
						)
							return null;
						const changed = await client.crmMigrationJob.updateMany({
							where: {
								workspaceId,
								id: row.id,
								backgroundEnabled: true,
								backgroundVersion: row.backgroundVersion,
							},
							data: {
								backgroundVersion: { increment: 1 },
								backgroundNextAttemptAt: new Date(time().getTime() + LEASE_MS),
							},
						});
						if (changed.count !== 1) return null;
						return {
							jobId: row.id,
							actorId: row.backgroundRequestedById,
							version: row.backgroundVersion + 1,
						};
					});
					if (!claim) continue;
					if (signal?.aborted) {
						await settle(claim, { busy: true });
						break;
					}
					const outcome = await executeBatch(c, claim.jobId, claim);
					const ack = await settle(claim, outcome);
					results.push({ jobId: claim.jobId, status: outcome.status, ...ack });
				} catch (error) {
					const fence = claim ?? {
						jobId: candidate.id,
						actorId: candidate.backgroundRequestedById,
						version: candidate.backgroundVersion,
					};
					const ack = await settle(fence, null, error);
					results.push({
						jobId: candidate.id,
						status: "REVIEW_OR_RETRY",
						...ack,
					});
				}
			}
			return {
				results,
				examined: rows.length,
				stopped: signal?.aborted === true,
			};
		},
	});
}
