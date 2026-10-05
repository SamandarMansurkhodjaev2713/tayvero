import { randomUUID } from "node:crypto";
import { fail } from "./errors.mjs";
import { JOB_STATUS, transitionStatus } from "./state.mjs";

function context(input) {
	if (
		!input ||
		typeof input !== "object" ||
		typeof input.tenantId !== "string" ||
		typeof input.actorId !== "string" ||
		!input.tenantId.trim() ||
		!input.actorId.trim() ||
		input.tenantId.length > 256 ||
		input.actorId.length > 256
	)
		fail("INVALID_CONTEXT", "Trusted tenant and actor context are required");
	return Object.freeze({ tenantId: input.tenantId, actorId: input.actorId });
}
function integer(value, path, min = 0) {
	if (!Number.isSafeInteger(value) || value < min)
		fail("INVALID_INTEGER", `${path} is invalid`);
	return value;
}
function isoDate(value, path) {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) fail("INVALID_DATE", `${path} is invalid`);
	return date;
}

export function createMigrationCoordinator({
	repository,
	clock = () => new Date(),
	leaseMs = 30_000,
	maxAttempts = 5,
	idFactory = randomUUID,
}) {
	if (!repository || typeof repository.transaction !== "function")
		fail("INVALID_REPOSITORY", "Migration repository is required");
	integer(leaseMs, "leaseMs", 1);
	integer(maxAttempts, "maxAttempts", 1);

	async function load(tx, tenantId, jobId) {
		const job = await tx.getJob(tenantId, jobId);
		if (!job) fail("JOB_NOT_FOUND", "Migration job was not found");
		return job;
	}
	return Object.freeze({
		async createJob({
			context: input,
			jobId = idFactory(),
			entityType,
			sourceFormat,
			sourceFilename,
			sourceSha256,
			sourceId,
			mapping,
		}) {
			const trusted = context(input);
			if (typeof jobId !== "string" || !jobId.trim() || jobId.length > 256)
				fail("INVALID_JOB_ID", "jobId must be a bounded non-empty identifier");
			if (typeof entityType !== "string" || !entityType)
				fail("INVALID_ENTITY_TYPE", "entityType is required");
			if (
				typeof sourceFormat !== "string" ||
				!/^[A-Z0-9_]{2,32}$/.test(sourceFormat)
			)
				fail(
					"INVALID_SOURCE_FORMAT",
					"sourceFormat is required and must be a stable uppercase identifier",
				);
			if (
				typeof sourceFilename !== "string" ||
				sourceFilename.trim() === "" ||
				sourceFilename === "." ||
				sourceFilename === ".." ||
				sourceFilename.length > 255 ||
				sourceFilename.includes("/") ||
				sourceFilename.includes("\\") ||
				sourceFilename.includes("\0")
			)
				fail(
					"INVALID_SOURCE_FILENAME",
					"sourceFilename must be a safe basename",
				);
			if (
				typeof sourceSha256 !== "string" ||
				!/^[a-f0-9]{64}$/.test(sourceSha256)
			)
				fail(
					"INVALID_SOURCE_DIGEST",
					"sourceSha256 must be a lowercase SHA-256 digest",
				);
			const now = isoDate(clock(), "clock").toISOString();
			if (
				sourceId !== undefined &&
				(typeof sourceId !== "string" || !sourceId || sourceId.length > 256)
			)
				fail("INVALID_SOURCE_ID", "Source identifier is invalid");
			const job = {
				...(sourceId === undefined ? {} : { sourceId }),
				...(mapping === undefined ? {} : { mapping: structuredClone(mapping) }),
				id: jobId,
				tenantId: trusted.tenantId,
				createdById: trusted.actorId,
				entityType,
				sourceFormat,
				sourceFilename,
				sourceSha256,
				status: JOB_STATUS.CREATED,
				version: 1,
				totalRows: 0,
				acceptedRows: 0,
				rejectedRows: 0,
				warningCount: 0,
				lastCompletedBatch: -1,
				createdAt: now,
				updatedAt: now,
			};
			return repository.transaction(async (tx) => {
				await tx.insertJob(job);
				await tx.appendEvent({
					tenantId: trusted.tenantId,
					jobId,
					type: "migration.job.created",
					at: now,
					actorId: trusted.actorId,
				});
				return job;
			});
		},
		/** Persist the job and its validated batch plan in one existing repository transaction. */
		async createPlannedJob({ dryRun, ...input }) {
			return repository.transaction(async (tx) => {
				const scoped = createMigrationCoordinator({
					repository: { transaction: (callback) => callback(tx) },
					clock,
					leaseMs,
					maxAttempts,
					idFactory,
				});
				const created = await scoped.createJob(input);
				return scoped.attachDryRun({
					context: input.context,
					jobId: created.id,
					dryRun,
				});
			});
		},
		async attachDryRun({ context: input, jobId, dryRun }) {
			const trusted = context(input);
			if (
				!dryRun ||
				dryRun.tenantId !== trusted.tenantId ||
				!Array.isArray(dryRun.batches)
			)
				fail(
					"INVALID_DRY_RUN",
					"Dry-run plan is invalid or belongs to another tenant",
				);
			return repository.transaction(async (tx) => {
				const current = await load(tx, trusted.tenantId, jobId);
				if (current.status !== JOB_STATUS.CREATED)
					fail(
						"JOB_NOT_CREATED",
						"Dry-run can only attach to a newly created job",
					);
				if (dryRun.entityType !== current.entityType)
					fail(
						"DRY_RUN_ENTITY_MISMATCH",
						"Dry-run entity type does not match the migration job",
					);
				const sourceRows = integer(
					dryRun.stats?.sourceRows,
					"dryRun.stats.sourceRows",
				);
				const errorRows = integer(
					dryRun.stats?.errorRows,
					"dryRun.stats.errorRows",
				);
				const warnings = integer(
					dryRun.stats?.warnings,
					"dryRun.stats.warnings",
				);
				transitionStatus(current.status, JOB_STATUS.VALIDATING);
				const validating = {
					...current,
					status: JOB_STATUS.VALIDATING,
					version: current.version + 1,
					updatedAt: isoDate(clock(), "clock").toISOString(),
				};
				await tx.replaceJob(
					trusted.tenantId,
					jobId,
					current.version,
					validating,
				);
				let rowOffset = 0;
				const batches = dryRun.batches.map((batch, expectedIndex) => {
					const index = integer(batch.index, "batch.index");
					if (index !== expectedIndex)
						fail(
							"INVALID_BATCH_SEQUENCE",
							"Dry-run batches must use contiguous zero-based indexes",
							{ expectedIndex, actualIndex: index },
						);
					if (
						typeof batch.digest !== "string" ||
						!/^[a-f0-9]{64}$/.test(batch.digest)
					)
						fail(
							"INVALID_BATCH_DIGEST",
							"Migration batch digest must be a lowercase SHA-256 digest",
							{ index },
						);
					const count = integer(batch.count, "batch.count", 1);
					const sourceRowNumbers = Array.isArray(batch.records)
						? batch.records
								.map((item) => item?.record?.sourceRowNumber)
								.filter(Number.isSafeInteger)
						: [];
					const rowStart =
						sourceRowNumbers.length === count && count > 0
							? Math.min(...sourceRowNumbers)
							: rowOffset;
					const rowEnd =
						sourceRowNumbers.length === count && count > 0
							? Math.max(...sourceRowNumbers)
							: count === 0
								? rowOffset
								: rowOffset + count - 1;
					rowOffset += count;
					return {
						index,
						digest: batch.digest,
						count,
						rowStart,
						rowEnd,
						status: "PENDING",
						attempts: 0,
						importedCount: 0,
						rejectedCount: 0,
						leaseOwner: null,
						leaseExpiresAt: null,
						completedAt: null,
						version: 1,
					};
				});
				const plannedRows = batches.reduce(
					(sum, batch) => sum + batch.count,
					0,
				);
				if (plannedRows + errorRows !== sourceRows)
					fail(
						"DRY_RUN_COUNT_MISMATCH",
						"Dry-run accepted and rejected row counts do not reconcile to the source row count",
						{ sourceRows, plannedRows, errorRows },
					);
				await tx.replaceBatches(trusted.tenantId, jobId, batches);
				const ready = {
					...validating,
					status: JOB_STATUS.READY,
					version: validating.version + 1,
					totalRows: sourceRows,
					acceptedRows: 0,
					rejectedRows: errorRows,
					warningCount: warnings,
					updatedAt: isoDate(clock(), "clock").toISOString(),
				};
				await tx.replaceJob(trusted.tenantId, jobId, validating.version, ready);
				await tx.appendEvent({
					tenantId: trusted.tenantId,
					jobId,
					type: "migration.job.ready",
					at: ready.updatedAt,
					actorId: trusted.actorId,
					batches: batches.length,
				});
				return ready;
			});
		},
		async startJob({ context: input, jobId }) {
			const trusted = context(input);
			return repository.transaction(async (tx) => {
				const current = await load(tx, trusted.tenantId, jobId);
				const status = transitionStatus(current.status, JOB_STATUS.IMPORTING);
				const next = {
					...current,
					status,
					version: current.version + 1,
					updatedAt: isoDate(clock(), "clock").toISOString(),
				};
				await tx.replaceJob(trusted.tenantId, jobId, current.version, next);
				return next;
			});
		},
		async runNextBatch({ context: input, jobId, workerId, importBatch }) {
			const trusted = context(input);
			if (typeof workerId !== "string" || workerId.length < 3)
				fail("INVALID_WORKER_ID", "workerId is required");
			if (typeof importBatch !== "function")
				fail("INVALID_IMPORTER", "importBatch callback is required");
			const now = isoDate(clock(), "clock");
			const claim = await repository.transaction(async (tx) => {
				const job = await load(tx, trusted.tenantId, jobId);
				if (job.status === JOB_STATUS.COMPLETED) return { done: true, job };
				if (job.status !== JOB_STATUS.IMPORTING)
					fail("JOB_NOT_IMPORTING", "Migration job is not importing", {
						status: job.status,
					});
				const batches = await tx.listBatches(trusted.tenantId, jobId);
				const candidate = batches.find(
					(batch) =>
						(batch.status === "PENDING" &&
							(!batch.leaseExpiresAt ||
								new Date(batch.leaseExpiresAt).getTime() <= now.getTime())) ||
						(batch.status === "RUNNING" &&
							batch.leaseExpiresAt &&
							new Date(batch.leaseExpiresAt).getTime() <= now.getTime()),
				);
				if (!candidate) {
					if (batches.every((batch) => batch.status === "COMPLETED")) {
						if (job.acceptedRows + job.rejectedRows !== job.totalRows)
							fail(
								"JOB_COUNT_MISMATCH",
								"Migration job counters do not reconcile to the source row count",
								{
									totalRows: job.totalRows,
									acceptedRows: job.acceptedRows,
									rejectedRows: job.rejectedRows,
								},
							);
						const completed = {
							...job,
							status: JOB_STATUS.COMPLETED,
							version: job.version + 1,
							updatedAt: now.toISOString(),
						};
						await tx.replaceJob(
							trusted.tenantId,
							jobId,
							job.version,
							completed,
						);
						await tx.appendEvent({
							tenantId: trusted.tenantId,
							jobId,
							type: "migration.job.completed",
							at: completed.updatedAt,
							actorId: trusted.actorId,
						});
						return { done: true, job: completed };
					}
					return { done: false, busy: true, job };
				}
				// Count the attempt when claiming, not when settling: killed processes must
				// consume the same bounded retry budget as explicit importer failures.
				if (candidate.attempts >= maxAttempts) {
					await tx.updateBatch(
						trusted.tenantId,
						jobId,
						candidate.index,
						(value) => ({
							...value,
							status: "FAILED",
							leaseOwner: null,
							leaseExpiresAt: null,
						}),
					);
					const failed = {
						...job,
						status: JOB_STATUS.FAILED,
						version: job.version + 1,
						updatedAt: now.toISOString(),
					};
					await tx.replaceJob(trusted.tenantId, jobId, job.version, failed);
					await tx.appendEvent({
						tenantId: trusted.tenantId,
						jobId,
						type: "migration.batch.failed",
						batchIndex: candidate.index,
						attempts: candidate.attempts,
						at: now.toISOString(),
						actorId: trusted.actorId,
						errorCode: "ATTEMPTS_EXHAUSTED",
					});
					return { done: true, failed: true, job: failed };
				}
				const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
				const claimed = await tx.updateBatch(
					trusted.tenantId,
					jobId,
					candidate.index,
					(batch) => ({
						...batch,
						status: "RUNNING",
						attempts: batch.attempts + 1,
						leaseOwner: workerId,
						leaseExpiresAt,
					}),
				);
				return {
					done: false,
					busy: false,
					job,
					batch: claimed,
					idempotencyKey: `migration:${trusted.tenantId}:${jobId}:${claimed.index}:${claimed.digest}`,
				};
			});
			if (claim.done || claim.busy) return claim;
			try {
				const outcome = await importBatch({
					tenantId: trusted.tenantId,
					jobId,
					batchIndex: claim.batch.index,
					digest: claim.batch.digest,
					idempotencyKey: claim.idempotencyKey,
					lease: Object.freeze({
						owner: workerId,
						version: claim.batch.version,
						expiresAt: claim.batch.leaseExpiresAt,
					}),
				});
				if (!outcome || typeof outcome !== "object" || Array.isArray(outcome))
					fail(
						"INVALID_IMPORT_OUTCOME",
						"Importer must return a row accounting object",
					);
				const importedCount = integer(
					outcome.importedCount,
					"outcome.importedCount",
				);
				const rejectedCount = integer(
					outcome.rejectedCount ?? 0,
					"outcome.rejectedCount",
				);
				if (importedCount + rejectedCount !== claim.batch.count)
					fail(
						"BATCH_OUTCOME_COUNT_MISMATCH",
						"Importer outcome must account for every row in the claimed batch",
						{
							batchIndex: claim.batch.index,
							batchCount: claim.batch.count,
							importedCount,
							rejectedCount,
						},
					);
				return await repository.transaction(async (tx) => {
					const current = await load(tx, trusted.tenantId, jobId);
					const batch = (await tx.listBatches(trusted.tenantId, jobId)).find(
						(item) => item.index === claim.batch.index,
					);
					if (
						!batch ||
						batch.status !== "RUNNING" ||
						batch.leaseOwner !== workerId ||
						batch.version !== claim.batch.version ||
						new Date(batch.leaseExpiresAt).getTime() <=
							isoDate(clock(), "clock").getTime()
					)
						fail("LEASE_LOST", "Worker no longer owns this migration batch");
					if (current.status !== JOB_STATUS.IMPORTING)
						fail(
							"JOB_NOT_IMPORTING",
							"Job stopped while the batch was running",
						);
					const completedAt = isoDate(clock(), "clock").toISOString();
					await tx.updateBatch(
						trusted.tenantId,
						jobId,
						batch.index,
						(value) => ({
							...value,
							status: "COMPLETED",
							attempts: value.attempts,
							importedCount,
							rejectedCount,
							leaseOwner: null,
							leaseExpiresAt: null,
							completedAt,
						}),
					);
					const next = {
						...current,
						acceptedRows: current.acceptedRows + importedCount,
						rejectedRows: current.rejectedRows + rejectedCount,
						lastCompletedBatch: Math.max(
							current.lastCompletedBatch,
							batch.index,
						),
						version: current.version + 1,
						updatedAt: isoDate(clock(), "clock").toISOString(),
					};
					await tx.replaceJob(trusted.tenantId, jobId, current.version, next);
					await tx.appendEvent({
						tenantId: trusted.tenantId,
						jobId,
						type: "migration.batch.completed",
						batchIndex: batch.index,
						at: next.updatedAt,
						actorId: trusted.actorId,
						importedCount,
						rejectedCount,
					});
					return {
						done: false,
						busy: false,
						job: next,
						batchIndex: batch.index,
						importedCount,
						rejectedCount,
					};
				});
			} catch (error) {
				await repository.transaction(async (tx) => {
					const job = await load(tx, trusted.tenantId, jobId);
					const batch = (await tx.listBatches(trusted.tenantId, jobId)).find(
						(item) => item.index === claim.batch.index,
					);
					if (
						!batch ||
						batch.status !== "RUNNING" ||
						batch.leaseOwner !== workerId ||
						batch.version !== claim.batch.version ||
						new Date(batch.leaseExpiresAt).getTime() <=
							isoDate(clock(), "clock").getTime()
					)
						return;
					const attempts = batch.attempts;
					const nonRetryable =
						[
							"BATCH_OUTCOME_COUNT_MISMATCH",
							"INVALID_IMPORT_OUTCOME",
							"INVALID_INTEGER",
						].includes(error?.code) || error?.retryable === false;
					const terminal =
						nonRetryable ||
						attempts >= maxAttempts ||
						job.status === JOB_STATUS.CANCELLED;
					await tx.updateBatch(
						trusted.tenantId,
						jobId,
						batch.index,
						(value) => ({
							...value,
							status: terminal ? "FAILED" : "PENDING",
							attempts,
							leaseOwner: null,
							leaseExpiresAt: null,
						}),
					);
					if (terminal && job.status === JOB_STATUS.IMPORTING) {
						const failed = {
							...job,
							status: JOB_STATUS.FAILED,
							version: job.version + 1,
							updatedAt: isoDate(clock(), "clock").toISOString(),
						};
						await tx.replaceJob(trusted.tenantId, jobId, job.version, failed);
					}
					await tx.appendEvent({
						tenantId: trusted.tenantId,
						jobId,
						type: terminal
							? "migration.batch.failed"
							: "migration.batch.retry_scheduled",
						batchIndex: batch.index,
						attempts,
						at: isoDate(clock(), "clock").toISOString(),
						actorId: trusted.actorId,
						errorCode:
							typeof error?.code === "string"
								? error.code.slice(0, 128)
								: "IMPORT_FAILED",
					});
				});
				throw error;
			}
		},
		async cancelJob({ context: input, jobId }) {
			const trusted = context(input);
			return repository.transaction(async (tx) => {
				const current = await load(tx, trusted.tenantId, jobId);
				const status = transitionStatus(current.status, JOB_STATUS.CANCELLED);
				const next = {
					...current,
					status,
					version: current.version + 1,
					updatedAt: isoDate(clock(), "clock").toISOString(),
				};
				await tx.replaceJob(trusted.tenantId, jobId, current.version, next);
				await tx.appendEvent({
					tenantId: trusted.tenantId,
					jobId,
					type: "migration.job.cancelled",
					at: next.updatedAt,
					actorId: trusted.actorId,
				});
				return next;
			});
		},
	});
}
