import { nextBatchState } from "./batch-invariants.mjs";
import { fail, MigrationRuntimeError } from "./errors.mjs";

const DEFAULT_TRANSACTION_MAX_ATTEMPTS = 3;
const DEFAULT_TRANSACTION_MAX_WAIT_MS = 5_000;
const DEFAULT_TRANSACTION_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 10;
const DEFAULT_RETRY_MAX_DELAY_MS = 100;

function hasFunction(value, name) {
	return (
		value !== null &&
		typeof value === "object" &&
		typeof value[name] === "function"
	);
}

function assertDelegate(client, name, methods) {
	const delegate = client?.[name];
	if (!delegate || typeof delegate !== "object") {
		fail("PRISMA_ADAPTER_CONFIGURATION", `Prisma delegate is missing: ${name}`);
	}
	for (const method of methods) {
		if (typeof delegate[method] !== "function") {
			fail(
				"PRISMA_ADAPTER_CONFIGURATION",
				`Prisma delegate ${name}.${method} is missing`,
			);
		}
	}
}

function assertPrisma(prisma) {
	if (!hasFunction(prisma, "$transaction")) {
		fail("PRISMA_ADAPTER_CONFIGURATION", "Prisma $transaction is missing");
	}
	assertDelegate(prisma, "crmMigrationJob", [
		"findFirst",
		"create",
		"updateMany",
	]);
	assertDelegate(prisma, "crmMigrationBatch", [
		"findMany",
		"findFirst",
		"deleteMany",
		"createMany",
		"updateMany",
	]);
	assertDelegate(prisma, "crmMigrationEvent", ["create", "findMany"]);
}

function boundedInteger(value, fallback, path, { min, max }) {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
		fail(
			"PRISMA_ADAPTER_CONFIGURATION",
			`${path} must be between ${min} and ${max}`,
		);
	}
	return resolved;
}

function prismaCode(error, code) {
	return error !== null && typeof error === "object" && error.code === code;
}

function isSerializationFailure(error) {
	return prismaCode(error, "P2034");
}

function defaultSleep(delayMs) {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function retryDelayMs(attempt, baseDelayMs, maxDelayMs, random) {
	if (baseDelayMs === 0) return 0;
	const ceiling = Math.min(
		maxDelayMs,
		baseDelayMs * 2 ** Math.max(0, attempt - 1),
	);
	const sample = random();
	if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
		fail(
			"PRISMA_ADAPTER_CONFIGURATION",
			"Migration retry random source must return a number in [0, 1)",
		);
	}
	return Math.floor(ceiling / 2 + sample * (ceiling / 2));
}

function asIso(value) {
	if (value == null) return null;
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime()))
		fail("CORRUPT_MIGRATION_DATA", "Stored date is invalid");
	return date.toISOString();
}

function toJob(row) {
	if (!row) return null;
	return Object.freeze({
		id: row.id,
		...(row.sourceId == null ? {} : { sourceId: row.sourceId }),
		...(row.mapping == null ? {} : { mapping: row.mapping }),
		tenantId: row.workspaceId,
		createdById: row.createdById,
		entityType: row.entityType,
		sourceFormat: row.sourceFormat,
		sourceFilename: row.sourceFilename,
		sourceSha256: row.sourceSha256,
		status: row.status,
		version: row.version,
		totalRows: row.totalRows,
		acceptedRows: row.acceptedRows,
		rejectedRows: row.rejectedRows,
		warningCount: row.warningCount,
		lastCompletedBatch: row.lastCompletedBatch,
		createdAt: asIso(row.createdAt),
		updatedAt: asIso(row.updatedAt),
	});
}

function toBatch(row) {
	return Object.freeze({
		index: row.batchIndex,
		digest: row.payloadSha256,
		count: row.rowCount,
		rowStart: row.rowStart,
		rowEnd: row.rowEnd,
		status: row.status,
		attempts: row.attemptCount,
		importedCount: row.importedCount,
		rejectedCount: row.rejectedCount,
		leaseOwner: row.leaseOwner ?? null,
		leaseExpiresAt: asIso(row.leaseExpiresAt),
		completedAt: asIso(row.completedAt),
		version: row.version,
	});
}

function eventDetails(event) {
	const {
		tenantId: _tenantId,
		jobId: _jobId,
		type: _type,
		actorId: _actorId,
		batchIndex: _batchIndex,
		at: _at,
		...details
	} = event;
	try {
		const serialized = JSON.stringify(details);
		return serialized === undefined ? {} : JSON.parse(serialized);
	} catch {
		fail(
			"INVALID_EVENT_DETAILS",
			"Migration event details must be JSON-serializable",
		);
	}
}

export function createPrismaMigrationRepository(prisma, options = {}) {
	const transactionMaxAttempts = boundedInteger(
		options.transactionMaxAttempts,
		DEFAULT_TRANSACTION_MAX_ATTEMPTS,
		"transactionMaxAttempts",
		{ min: 1, max: 10 },
	);
	const transactionMaxWaitMs = boundedInteger(
		options.transactionMaxWaitMs,
		DEFAULT_TRANSACTION_MAX_WAIT_MS,
		"transactionMaxWaitMs",
		{ min: 100, max: 60_000 },
	);
	const transactionTimeoutMs = boundedInteger(
		options.transactionTimeoutMs,
		DEFAULT_TRANSACTION_TIMEOUT_MS,
		"transactionTimeoutMs",
		{ min: 100, max: 120_000 },
	);
	const retryBaseDelayMs = boundedInteger(
		options.retryBaseDelayMs,
		DEFAULT_RETRY_BASE_DELAY_MS,
		"retryBaseDelayMs",
		{ min: 0, max: 10_000 },
	);
	const retryMaxDelayMs = boundedInteger(
		options.retryMaxDelayMs,
		DEFAULT_RETRY_MAX_DELAY_MS,
		"retryMaxDelayMs",
		{ min: retryBaseDelayMs, max: 30_000 },
	);
	const sleep = options.sleep ?? defaultSleep;
	const random = options.random ?? Math.random;
	if (typeof sleep !== "function" || typeof random !== "function")
		fail(
			"PRISMA_ADAPTER_CONFIGURATION",
			"Migration retry dependencies must be functions",
		);
	assertPrisma(prisma);

	function scoped(client, allowTransaction) {
		return Object.freeze({
			async transaction(callback) {
				if (!allowTransaction || typeof client.$transaction !== "function")
					fail(
						"NESTED_TRANSACTION_UNSUPPORTED",
						"Nested migration transactions are not supported",
					);
				for (let attempt = 1; attempt <= transactionMaxAttempts; attempt += 1) {
					try {
						return await client.$transaction(
							(tx) => callback(scoped(tx, false)),
							{
								isolationLevel: "Serializable",
								maxWait: transactionMaxWaitMs,
								timeout: transactionTimeoutMs,
							},
						);
					} catch (error) {
						if (!isSerializationFailure(error)) throw error;
						if (attempt >= transactionMaxAttempts)
							fail(
								"TRANSACTION_RETRY_EXHAUSTED",
								"Migration transaction retry policy was exhausted",
								{ attempts: transactionMaxAttempts },
							);
						const delay = retryDelayMs(
							attempt,
							retryBaseDelayMs,
							retryMaxDelayMs,
							random,
						);
						if (delay > 0) await sleep(delay);
					}
				}
				fail(
					"TRANSACTION_RETRY_EXHAUSTED",
					"Migration transaction retry policy was exhausted",
					{ attempts: transactionMaxAttempts },
				);
			},

			async insertJob(job) {
				try {
					const row = await client.crmMigrationJob.create({
						data: {
							id: job.id,
							...(job.sourceId === undefined ? {} : { sourceId: job.sourceId }),
							...(job.mapping === undefined ? {} : { mapping: job.mapping }),
							workspaceId: job.tenantId,
							createdById: job.createdById,
							entityType: job.entityType,
							sourceFormat: job.sourceFormat,
							sourceFilename: job.sourceFilename,
							sourceSha256: job.sourceSha256,
							status: job.status,
							version: job.version,
							totalRows: job.totalRows,
							acceptedRows: job.acceptedRows,
							rejectedRows: job.rejectedRows,
							warningCount: job.warningCount,
							lastCompletedBatch: job.lastCompletedBatch,
							createdAt: new Date(job.createdAt),
							updatedAt: new Date(job.updatedAt),
						},
					});
					return toJob(row);
				} catch (error) {
					if (prismaCode(error, "P2002"))
						fail("JOB_EXISTS", "Migration job already exists");
					throw error;
				}
			},

			async getJob(tenantId, id) {
				return toJob(
					await client.crmMigrationJob.findFirst({
						where: { workspaceId: tenantId, id },
					}),
				);
			},

			async replaceJob(tenantId, id, expectedVersion, next) {
				const result = await client.crmMigrationJob.updateMany({
					where: { workspaceId: tenantId, id, version: expectedVersion },
					data: {
						status: next.status,
						version: next.version,
						totalRows: next.totalRows,
						acceptedRows: next.acceptedRows,
						rejectedRows: next.rejectedRows,
						warningCount: next.warningCount,
						lastCompletedBatch: next.lastCompletedBatch,
						updatedAt: new Date(next.updatedAt),
					},
				});
				if (result.count !== 1) {
					const exists = await client.crmMigrationJob.findFirst({
						where: { workspaceId: tenantId, id },
						select: { id: true },
					});
					if (!exists) fail("JOB_NOT_FOUND", "Migration job was not found");
					fail("STALE_JOB", "Migration job changed after it was read");
				}
				return Object.freeze({ ...next });
			},

			async replaceBatches(tenantId, jobId, batches) {
				await client.crmMigrationBatch.deleteMany({
					where: { workspaceId: tenantId, jobId },
				});
				if (batches.length === 0) return;
				await client.crmMigrationBatch.createMany({
					data: batches.map((batch) => ({
						workspaceId: tenantId,
						jobId,
						batchIndex: batch.index,
						rowStart: batch.rowStart,
						rowEnd: batch.rowEnd,
						rowCount: batch.count,
						payloadSha256: batch.digest,
						status: batch.status,
						attemptCount: batch.attempts,
						importedCount: batch.importedCount,
						rejectedCount: batch.rejectedCount,
						leaseOwner: batch.leaseOwner,
						leaseExpiresAt: batch.leaseExpiresAt
							? new Date(batch.leaseExpiresAt)
							: null,
						completedAt: batch.completedAt ? new Date(batch.completedAt) : null,
						version: batch.version ?? 1,
					})),
				});
			},

			async listBatches(tenantId, jobId) {
				const rows = await client.crmMigrationBatch.findMany({
					where: { workspaceId: tenantId, jobId },
					orderBy: { batchIndex: "asc" },
				});
				return rows.map(toBatch);
			},

			async updateBatch(tenantId, jobId, batchIndex, updater) {
				const row = await client.crmMigrationBatch.findFirst({
					where: { workspaceId: tenantId, jobId, batchIndex },
				});
				if (!row) fail("BATCH_NOT_FOUND", "Migration batch was not found");
				const current = toBatch(row);
				const proposed = updater({ ...current });
				const next = nextBatchState(current, proposed);
				const result = await client.crmMigrationBatch.updateMany({
					where: {
						workspaceId: tenantId,
						jobId,
						batchIndex,
						version: current.version,
					},
					data: {
						status: next.status,
						attemptCount: next.attempts,
						importedCount: next.importedCount,
						rejectedCount: next.rejectedCount,
						leaseOwner: next.leaseOwner,
						leaseExpiresAt: next.leaseExpiresAt
							? new Date(next.leaseExpiresAt)
							: null,
						completedAt: next.completedAt ? new Date(next.completedAt) : null,
						version: next.version,
					},
				});
				if (result.count !== 1)
					fail("STALE_BATCH", "Migration batch changed after it was read");
				return Object.freeze(next);
			},

			async appendEvent(event) {
				await client.crmMigrationEvent.create({
					data: {
						workspaceId: event.tenantId,
						jobId: event.jobId,
						type: event.type,
						actorId: event.actorId ?? null,
						batchIndex: Number.isSafeInteger(event.batchIndex)
							? event.batchIndex
							: null,
						details: eventDetails(event),
						createdAt: new Date(event.at),
					},
				});
			},

			async events(tenantId, jobId) {
				return client.crmMigrationEvent.findMany({
					where: { workspaceId: tenantId, ...(jobId ? { jobId } : {}) },
					orderBy: [{ createdAt: "asc" }, { id: "asc" }],
				});
			},
		});
	}

	return scoped(prisma, true);
}
