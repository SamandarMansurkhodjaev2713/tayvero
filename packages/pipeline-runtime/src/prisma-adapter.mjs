import { createHash } from "node:crypto";
import {
	PipelineDomainError,
	RESERVED_STAGE_KEY_PREFIX,
	parseAssignment,
	parsePipelineDefinition,
} from "@crm/pipeline-core";
import { MAX_PIPELINES_PER_WORKSPACE } from "./constants.mjs";
import { PipelineRuntimeError, fail } from "./errors.mjs";

const TEMP_POSITION_BASE = 1_000_000;
const TEMP_KEY_PREFIX = RESERVED_STAGE_KEY_PREFIX;
const DEFAULT_TRANSACTION_MAX_ATTEMPTS = 3;
const DEFAULT_TRANSACTION_MAX_WAIT_MS = 5_000;
const DEFAULT_TRANSACTION_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 10;
const DEFAULT_RETRY_MAX_DELAY_MS = 100;
const HASH = /^[0-9a-f]{64}$/;

function hasFunction(value, name) {
	return value !== null && typeof value === "object" && typeof value[name] === "function";
}

function assertDelegate(client, name, methods) {
	const delegate = client?.[name];
	if (delegate === null || typeof delegate !== "object") {
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

function assertPrisma(prisma, receiptDelegate, auditDelegate) {
	if (!hasFunction(prisma, "$transaction")) {
		fail("PRISMA_ADAPTER_CONFIGURATION", "Prisma $transaction is missing");
	}
	assertDelegate(prisma, "crmPipeline", [
		"count",
		"findMany",
		"findFirst",
		"create",
		"updateMany",
	]);
	assertDelegate(prisma, "crmPipelineStage", [
		"update",
		"upsert",
		"deleteMany",
	]);
	assertDelegate(prisma, "crmDealPipelineAssignment", [
		"count",
		"create",
		"findFirst",
		"updateMany",
	]);
	assertDelegate(prisma, receiptDelegate, ["findFirst", "create"]);
	assertDelegate(prisma, auditDelegate, ["create"]);
}

function boundedInteger(value, fallback, path, { min, max }) {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
		fail(
			"PRISMA_ADAPTER_CONFIGURATION",
			`${path} must be a safe integer between ${min} and ${max}`,
			{ path, min, max },
		);
	}
	return resolved;
}

function asStringArray(value, path) {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
		fail("CORRUPT_PIPELINE_DATA", `${path} must be a string array`, { path });
	}
	return value;
}

function mapDomainError(error, path) {
	if (error instanceof PipelineRuntimeError) throw error;
	if (error instanceof PipelineDomainError) {
		fail("CORRUPT_PIPELINE_DATA", `Stored ${path} is invalid`, {
			path,
			causeCode: error.code,
		});
	}
	throw error;
}

function toDomainPipeline(row, path = "pipeline") {
	if (!row) return null;
	try {
		return parsePipelineDefinition({
			id: row.id,
			tenantId: row.workspaceId,
			name: row.name,
			slug: row.slug,
			isDefault: row.isDefault,
			isArchived: row.isArchived,
			version: row.version,
			stages: (row.stages ?? []).map((stage, index) => ({
				id: stage.id,
				key: stage.key,
				name: stage.name,
				position: stage.position,
				type: stage.stageType,
				probabilityBps: stage.probabilityBps,
				color: stage.color ?? null,
				allowedFromStageIds: asStringArray(
					stage.allowedFromStageIds,
					`${path}.stages[${index}].allowedFromStageIds`,
				),
			})),
		});
	} catch (error) {
		return mapDomainError(error, path);
	}
}

function toAssignment(row, path = "assignment") {
	if (!row) return null;
	try {
		return parseAssignment(
			{
				tenantId: row.workspaceId,
				dealId: row.dealId,
				pipelineId: row.pipelineId,
				stageId: row.stageId,
				version: row.version,
			},
			path,
		);
	} catch (error) {
		return mapDomainError(error, path);
	}
}

function temporaryKey(stageId, index) {
	const digest = createHash("sha256")
		.update(`${stageId}:${index}`)
		.digest("hex")
		.slice(0, 32);
	// The domain validator reserves this prefix, so a user-controlled stage key
	// can never collide with the transaction-only neutralization namespace.
	return `${TEMP_KEY_PREFIX}${digest}`;
}

function prismaCode(error, code) {
	return error !== null && typeof error === "object" && "code" in error && error.code === code;
}

function isPrismaUniqueViolation(error) {
	return prismaCode(error, "P2002");
}

function isPrismaForeignKeyViolation(error) {
	return prismaCode(error, "P2003");
}

function isPrismaRecordNotFound(error) {
	return prismaCode(error, "P2025");
}

function isPrismaSerializationFailure(error) {
	return prismaCode(error, "P2034");
}

function uniqueTargetContains(error, field) {
	if (error === null || typeof error !== "object" || !("meta" in error)) return false;
	const target = error.meta?.target;
	if (Array.isArray(target)) return target.includes(field);
	return typeof target === "string" && target.includes(field);
}

function defaultSleep(delayMs) {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function retryDelayMs(attempt, baseDelayMs, maxDelayMs, random) {
	if (baseDelayMs === 0) return 0;
	const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
	const sample = random();
	if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
		fail(
			"PRISMA_ADAPTER_CONFIGURATION",
			"Pipeline transaction retry random source must return a number in [0, 1)",
		);
	}
	return Math.floor(ceiling / 2 + sample * (ceiling / 2));
}

function assertPipelineResult(value, operation) {
	if (!value) {
		fail(
			"CORRUPT_PIPELINE_DATA",
			`Pipeline disappeared after ${operation}`,
			{ operation },
		);
	}
	return value;
}

function changedStageTypeIds(current, next) {
	const currentById = new Map(current.stages.map((stage) => [stage.id, stage]));
	return next.stages
		.filter((stage) => {
			const previous = currentById.get(stage.id);
			return previous && previous.type !== stage.type;
		})
		.map((stage) => stage.id);
}

export function createPrismaPipelineRepository(prisma, options = {}) {
	const receiptDelegate = options.receiptDelegate ?? "crmPipelineCommandReceipt";
	const auditDelegate = options.auditDelegate ?? "crmPipelineAuditEvent";
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
	if (typeof sleep !== "function" || typeof random !== "function") {
		fail(
			"PRISMA_ADAPTER_CONFIGURATION",
			"Pipeline transaction retry dependencies must be functions",
		);
	}
	assertPrisma(prisma, receiptDelegate, auditDelegate);

	function scoped(client, allowTransaction) {
		const repository = {
			async transaction(callback) {
				if (!allowTransaction || typeof client.$transaction !== "function") {
					fail(
						"NESTED_TRANSACTION_UNSUPPORTED",
						"Nested pipeline transactions are not supported",
					);
				}
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
						if (!isPrismaSerializationFailure(error)) {
							throw error;
						}
						if (attempt >= transactionMaxAttempts) {
							fail(
								"TRANSACTION_RETRY_EXHAUSTED",
								"Pipeline transaction retry policy was exhausted",
								{ attempts: transactionMaxAttempts },
							);
						}
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
					"Pipeline transaction retry policy was exhausted",
					{ attempts: transactionMaxAttempts },
				);
			},

			async listPipelines(tenantId) {
				const rows = await client.crmPipeline.findMany({
					where: { workspaceId: tenantId },
					include: { stages: { orderBy: { position: "asc" } } },
					orderBy: [{ isArchived: "asc" }, { name: "asc" }, { id: "asc" }],
					take: MAX_PIPELINES_PER_WORKSPACE + 1,
				});
				if (rows.length > MAX_PIPELINES_PER_WORKSPACE) {
					fail(
						"CORRUPT_PIPELINE_DATA",
						"Workspace contains more pipelines than the supported bound",
						{ maxPipelines: MAX_PIPELINES_PER_WORKSPACE },
					);
				}
				return rows.map((row, index) => toDomainPipeline(row, `pipelines[${index}]`));
			},

			async getPipeline(tenantId, id) {
				const row = await client.crmPipeline.findFirst({
					where: { workspaceId: tenantId, id },
					include: { stages: { orderBy: { position: "asc" } } },
				});
				return toDomainPipeline(row);
			},

			async insertPipeline(input) {
				const pipeline = parsePipelineDefinition(input);
				const pipelineCount = await client.crmPipeline.count({
					where: { workspaceId: pipeline.tenantId },
				});
				if (pipelineCount >= MAX_PIPELINES_PER_WORKSPACE) {
					fail("PIPELINE_LIMIT", "Workspace pipeline limit was reached", {
						maxPipelines: MAX_PIPELINES_PER_WORKSPACE,
					});
				}
				const effectiveDefault = pipeline.isDefault || pipelineCount === 0;
				if (effectiveDefault) {
					await client.crmPipeline.updateMany({
						where: {
							workspaceId: pipeline.tenantId,
							isDefault: true,
							isArchived: false,
						},
						data: { isDefault: false, version: { increment: 1 } },
					});
				}
				try {
					const row = await client.crmPipeline.create({
						data: {
							id: pipeline.id,
							workspaceId: pipeline.tenantId,
							name: pipeline.name,
							slug: pipeline.slug,
							isDefault: effectiveDefault,
							isArchived: pipeline.isArchived,
							version: pipeline.version,
							stages: {
								create: pipeline.stages.map((stage) => ({
									id: stage.id,
									workspaceId: pipeline.tenantId,
									key: stage.key,
									name: stage.name,
									position: stage.position,
									stageType: stage.type,
									probabilityBps: stage.probabilityBps,
									color: stage.color,
									allowedFromStageIds: [...stage.allowedFromStageIds],
									version: 1,
								})),
							},
						},
						include: { stages: { orderBy: { position: "asc" } } },
					});
					return assertPipelineResult(toDomainPipeline(row), "create");
				} catch (error) {
					if (isPrismaUniqueViolation(error)) {
						if (uniqueTargetContains(error, "slug")) {
							fail("PIPELINE_SLUG_EXISTS", "Pipeline slug already exists");
						}
						if (uniqueTargetContains(error, "is_default")) {
							fail(
								"PIPELINE_DEFAULT_CONFLICT",
								"Another request changed the default pipeline concurrently",
							);
						}
						fail("PIPELINE_EXISTS", "Pipeline ID or stage identity already exists");
					}
					throw error;
				}
			},

			async replacePipeline(tenantId, id, expectedVersion, nextInput) {
				const next = parsePipelineDefinition(nextInput);
				if (next.tenantId !== tenantId || next.id !== id) {
					fail("TENANT_MISMATCH", "Replacement identity does not match its selector");
				}
				const currentRow = await client.crmPipeline.findFirst({
					where: { workspaceId: tenantId, id },
					include: { stages: { orderBy: { position: "asc" } } },
				});
				if (!currentRow) fail("PIPELINE_NOT_FOUND", "Pipeline was not found");
				const current = toDomainPipeline(currentRow);
				if (current.version !== expectedVersion) {
					fail("STALE_PIPELINE", "Pipeline changed after it was read", {
						expectedVersion,
						actualVersion: current.version,
					});
				}

				const nextIds = new Set(next.stages.map((stage) => stage.id));
				const removedIds = current.stages
					.map((stage) => stage.id)
					.filter((stageId) => !nextIds.has(stageId));
				const typeChangedIds = changedStageTypeIds(current, next);
				if (removedIds.length > 0) {
					const assigned = await repository.countAssignmentsByStageIds(
						tenantId,
						id,
						removedIds,
					);
					if (assigned > 0) {
						fail("STAGE_IN_USE", "A stage with assigned deals cannot be removed", {
							stageIds: removedIds,
						});
					}
				}
				if (typeChangedIds.length > 0) {
					const assigned = await repository.countAssignmentsByStageIds(
						tenantId,
						id,
						typeChangedIds,
					);
					if (assigned > 0) {
						fail(
							"STAGE_TYPE_IN_USE",
							"A stage with assigned deals cannot change outcome type",
							{ stageIds: typeChangedIds },
						);
					}
				}

				let updated;
				try {
					updated = await client.crmPipeline.updateMany({
						where: { workspaceId: tenantId, id, version: expectedVersion },
						data: {
							name: next.name,
							slug: next.slug,
							isDefault: next.isDefault,
							isArchived: next.isArchived,
							version: next.version,
						},
					});
				} catch (error) {
					if (isPrismaUniqueViolation(error)) {
						fail("PIPELINE_SLUG_EXISTS", "Another pipeline already uses this slug");
					}
					throw error;
				}
				if (updated.count !== 1) {
					fail(
						"STALE_PIPELINE",
						"Pipeline update lost an optimistic concurrency race",
					);
				}

				for (let index = 0; index < current.stages.length; index += 1) {
					const stage = current.stages[index];
					try {
						await client.crmPipelineStage.update({
							where: {
								workspaceId_pipelineId_id: {
									workspaceId: tenantId,
									pipelineId: id,
									id: stage.id,
								},
							},
							data: {
								position: TEMP_POSITION_BASE + index,
								key: temporaryKey(stage.id, index),
							},
						});
					} catch (error) {
						if (isPrismaRecordNotFound(error)) {
							fail("STALE_PIPELINE", "A pipeline stage changed during the update", {
								stageId: stage.id,
							});
						}
						throw error;
					}
				}

				try {
					for (const stage of next.stages) {
						await client.crmPipelineStage.upsert({
							where: {
								workspaceId_pipelineId_id: {
									workspaceId: tenantId,
									pipelineId: id,
									id: stage.id,
								},
							},
							create: {
								id: stage.id,
								workspaceId: tenantId,
								pipelineId: id,
								key: stage.key,
								name: stage.name,
								position: stage.position,
								stageType: stage.type,
								probabilityBps: stage.probabilityBps,
								color: stage.color,
								allowedFromStageIds: [...stage.allowedFromStageIds],
								version: 1,
							},
							update: {
								key: stage.key,
								name: stage.name,
								position: stage.position,
								stageType: stage.type,
								probabilityBps: stage.probabilityBps,
								color: stage.color,
								allowedFromStageIds: [...stage.allowedFromStageIds],
								version: { increment: 1 },
							},
						});
					}
				} catch (error) {
					if (isPrismaUniqueViolation(error)) {
						fail(
							"PIPELINE_STAGE_CONFLICT",
							"Pipeline stage ID, key or position conflicts with another stage",
						);
					}
					if (isPrismaForeignKeyViolation(error)) {
						fail("STAGE_IN_USE", "A stage relation changed concurrently");
					}
					throw error;
				}

				if (removedIds.length > 0) {
					try {
						const deletion = await client.crmPipelineStage.deleteMany({
							where: {
								workspaceId: tenantId,
								pipelineId: id,
								id: { in: removedIds },
							},
						});
						if (deletion.count !== removedIds.length) {
							fail(
								"STALE_PIPELINE",
								"Pipeline stages changed during the update",
								{
									expectedRemoved: removedIds.length,
									actualRemoved: deletion.count,
								},
							);
						}
					} catch (error) {
						if (isPrismaForeignKeyViolation(error)) {
							fail(
								"STAGE_IN_USE",
								"A stage gained an assignment while the pipeline was being updated",
								{ stageIds: removedIds },
							);
						}
						throw error;
					}
				}
				return assertPipelineResult(
					await repository.getPipeline(tenantId, id),
					"update",
				);
			},

			async setDefault(tenantId, pipelineId, expectedVersion) {
				const target = await client.crmPipeline.findFirst({
					where: { workspaceId: tenantId, id: pipelineId },
					select: { id: true, version: true, isDefault: true, isArchived: true },
				});
				if (!target) fail("PIPELINE_NOT_FOUND", "Pipeline was not found");
				if (target.version !== expectedVersion) {
					fail("STALE_PIPELINE", "Pipeline changed after it was read", {
						expectedVersion,
						actualVersion: target.version,
					});
				}
				if (target.isArchived) {
					fail("PIPELINE_ARCHIVED", "Archived pipeline cannot become default");
				}
				if (target.isDefault) {
					return assertPipelineResult(
						await repository.getPipeline(tenantId, pipelineId),
						"default selection",
					);
				}
				try {
					await client.crmPipeline.updateMany({
						where: {
							workspaceId: tenantId,
							isDefault: true,
							isArchived: false,
							NOT: { id: pipelineId },
						},
						data: { isDefault: false, version: { increment: 1 } },
					});
					const promoted = await client.crmPipeline.updateMany({
						where: {
							workspaceId: tenantId,
							id: pipelineId,
							version: expectedVersion,
							isDefault: false,
							isArchived: false,
						},
						data: { isDefault: true, version: { increment: 1 } },
					});
					if (promoted.count !== 1) {
						fail(
							"STALE_PIPELINE",
							"Default-pipeline update lost an optimistic concurrency race",
						);
					}
				} catch (error) {
					if (isPrismaUniqueViolation(error)) {
						fail(
							"PIPELINE_DEFAULT_CONFLICT",
							"Another request changed the default pipeline concurrently",
						);
					}
					throw error;
				}
				return assertPipelineResult(
					await repository.getPipeline(tenantId, pipelineId),
					"default switch",
				);
			},

			async countOpenAssignments(tenantId, pipelineId) {
				return client.crmDealPipelineAssignment.count({
					where: {
						workspaceId: tenantId,
						pipelineId,
						stage: { stageType: "OPEN" },
					},
				});
			},

			async countAssignmentsByStageIds(tenantId, pipelineId, stageIds) {
				if (stageIds.length === 0) return 0;
				return client.crmDealPipelineAssignment.count({
					where: {
						workspaceId: tenantId,
						pipelineId,
						stageId: { in: [...stageIds] },
					},
				});
			},

			async insertAssignment(input) {
				const assignment = parseAssignment(input);
				try {
					const row = await client.crmDealPipelineAssignment.create({
						data: {
							workspaceId: assignment.tenantId,
							dealId: assignment.dealId,
							pipelineId: assignment.pipelineId,
							stageId: assignment.stageId,
							version: assignment.version,
						},
					});
					return toAssignment(row);
				} catch (error) {
					if (isPrismaUniqueViolation(error)) {
						fail("ASSIGNMENT_EXISTS", "Deal already has a pipeline assignment");
					}
					if (isPrismaForeignKeyViolation(error)) {
						fail("PIPELINE_STAGE_NOT_FOUND", "Assignment stage was not found");
					}
					throw error;
				}
			},

			async getAssignment(tenantId, dealId) {
				const row = await client.crmDealPipelineAssignment.findFirst({
					where: { workspaceId: tenantId, dealId },
				});
				return toAssignment(row);
			},

			async replaceAssignment(tenantId, dealId, expectedVersion, nextInput) {
				const next = parseAssignment(nextInput);
				if (next.tenantId !== tenantId || next.dealId !== dealId) {
					fail("TENANT_MISMATCH", "Assignment identity does not match its selector");
				}
				try {
					const result = await client.crmDealPipelineAssignment.updateMany({
						where: { workspaceId: tenantId, dealId, version: expectedVersion },
						data: {
							pipelineId: next.pipelineId,
							stageId: next.stageId,
							version: next.version,
							enteredAt: new Date(),
						},
					});
					if (result.count !== 1) {
						fail(
							"STALE_ASSIGNMENT",
							"Deal stage update lost an optimistic concurrency race",
						);
					}
					return next;
				} catch (error) {
					if (isPrismaForeignKeyViolation(error)) {
						fail("PIPELINE_STAGE_NOT_FOUND", "Target pipeline stage was not found");
					}
					throw error;
				}
			},

			async getReceipt(tenantId, action, key) {
				const row = await client[receiptDelegate].findFirst({
					where: { workspaceId: tenantId, action, idempotencyKey: key },
				});
				if (!row) return null;
				if (
					row.workspaceId !== tenantId ||
					row.action !== action ||
					row.idempotencyKey !== key ||
					typeof row.payloadHash !== "string" ||
					!HASH.test(row.payloadHash)
				) {
					fail("CORRUPT_PIPELINE_DATA", "Stored command receipt is invalid");
				}
				return Object.freeze({
					tenantId,
					action,
					idempotencyKey: key,
					payloadHash: row.payloadHash,
					result: row.resultJson,
				});
			},

			async putReceipt(receipt) {
				try {
					await client[receiptDelegate].create({
						data: {
							workspaceId: receipt.tenantId,
							action: receipt.action,
							idempotencyKey: receipt.idempotencyKey,
							payloadHash: receipt.payloadHash,
							resultJson: receipt.result,
						},
					});
				} catch (error) {
					if (isPrismaUniqueViolation(error)) {
						fail("RECEIPT_EXISTS", "Command receipt already exists");
					}
					throw error;
				}
			},

			async appendAudit(event) {
				await client[auditDelegate].create({
					data: {
						workspaceId: event.tenantId,
						actorId: event.actorId,
						requestId: event.requestId,
						action: event.action,
						payloadHash: event.payloadHash,
						outcome: event.outcome,
						entityId: event.entityId,
					},
				});
			},
		};
		return repository;
	}

	return scoped(prisma, true);
}
