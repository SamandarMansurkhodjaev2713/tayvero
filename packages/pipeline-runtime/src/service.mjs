
import {
	PipelineDomainError,
	parseAssignment,
	parsePipelineDefinition,
	planDealStageTransition,
} from "@crm/pipeline-core";
import { payloadHash } from "./canonical.mjs";
import { createRuntimeContext, requirePermission } from "./context.mjs";
import { MAX_PIPELINES_PER_WORKSPACE } from "./constants.mjs";
import { PipelineRuntimeError, fail } from "./errors.mjs";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/;
const ACTION_PERMISSIONS = Object.freeze({
	"pipeline.create": "pipeline.create",
	"pipeline.update": "pipeline.update",
	"pipeline.set_default": "pipeline.set_default",
	"pipeline.archive": "pipeline.archive",
	"pipeline.restore": "pipeline.restore",
	"deal.transition": "deal.transition",
});
const PIPELINE_RESULT_ACTIONS = new Set([
	"pipeline.create",
	"pipeline.update",
	"pipeline.set_default",
	"pipeline.archive",
	"pipeline.restore",
]);

function idempotencyKey(value) {
	if (
		typeof value !== "string" ||
		value.length < 8 ||
		value.length > 200 ||
		!/^[A-Za-z0-9_.:-]+$/.test(value)
	) {
		fail("INVALID_IDEMPOTENCY_KEY", "A stable idempotency key is required");
	}
	return value;
}

function identifier(value, code, label) {
	if (typeof value !== "string" || !SAFE_ID.test(value)) {
		fail(code, `${label} is invalid`);
	}
	return value;
}

function positiveVersion(value, path = "expectedVersion") {
	if (!Number.isSafeInteger(value) || value < 1) {
		fail("INVALID_VERSION", `${path} must be a positive safe integer`, { path });
	}
	return value;
}

function entityId(result) {
	if (result === null || typeof result !== "object") return null;
	if (typeof result.id === "string" && SAFE_ID.test(result.id)) return result.id;
	if (typeof result.dealId === "string" && SAFE_ID.test(result.dealId)) {
		return result.dealId;
	}
	return null;
}

function parseRepositoryPipeline(value, path = "pipeline") {
	try {
		return parsePipelineDefinition(value);
	} catch (error) {
		if (error instanceof PipelineDomainError) {
			fail("CORRUPT_PIPELINE_DATA", `Stored ${path} is invalid`, {
				path,
				causeCode: error.code,
			});
		}
		throw error;
	}
}

function parseRepositoryAssignment(value, path = "assignment") {
	try {
		return parseAssignment(value, path);
	} catch (error) {
		if (error instanceof PipelineDomainError) {
			fail("CORRUPT_PIPELINE_DATA", `Stored ${path} is invalid`, {
				path,
				causeCode: error.code,
			});
		}
		throw error;
	}
}

function parseActionResult(action, value) {
	if (PIPELINE_RESULT_ACTIONS.has(action)) {
		return parseRepositoryPipeline(value, `receipt.${action}.result`);
	}
	if (action === "deal.transition") {
		return parseRepositoryAssignment(value, `receipt.${action}.result`);
	}
	fail("INVALID_ACTION", "Pipeline command action is not replayable", { action });
}

async function withRuntimeErrorBoundary(operation) {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof PipelineRuntimeError) throw error;
		if (error instanceof PipelineDomainError) {
			throw new PipelineRuntimeError(error.code, error.message, error.details);
		}
		throw error;
	}
}

async function readCommittedReceipt(
	repository,
	context,
	action,
	key,
	hash,
) {
	const existing = await repository.getReceipt(
		context.tenantId,
		action,
		key,
	);
	if (!existing) return Object.freeze({ found: false, result: null });
	if (existing.payloadHash !== hash) {
		fail(
			"IDEMPOTENCY_KEY_REUSED",
			"Idempotency key was already used with another payload",
		);
	}
	return Object.freeze({
		found: true,
		result: parseActionResult(action, existing.result),
	});
}

async function idempotent(
	repository,
	context,
	action,
	key,
	operationPayload,
	operation,
	idempotencyPayload = operationPayload,
) {
	const hash = payloadHash(idempotencyPayload);
	try {
		return await repository.transaction(async (tx) => {
			const existing = await tx.getReceipt(context.tenantId, action, key);
			if (existing) {
				if (existing.payloadHash !== hash) {
					fail(
						"IDEMPOTENCY_KEY_REUSED",
						"Idempotency key was already used with another payload",
					);
				}
				return parseActionResult(action, existing.result);
			}

			const result = parseActionResult(action, await operation(tx));
			await tx.appendAudit({
				tenantId: context.tenantId,
				actorId: context.actorId,
				requestId: context.requestId,
				action,
				payloadHash: hash,
				outcome: "SUCCESS",
				entityId: entityId(result),
			});
			await tx.putReceipt({
				tenantId: context.tenantId,
				action,
				idempotencyKey: key,
				payloadHash: hash,
				result,
			});
			return result;
		});
	} catch (error) {
		if (error instanceof PipelineRuntimeError) {
			try {
				// A concurrent request may commit the same command after this request's
				// initial receipt read but before its domain mutation. In that race the
				// loser can observe PIPELINE_EXISTS/STALE_* rather than RECEIPT_EXISTS.
				// Re-read the committed receipt after every deterministic runtime failure
				// and replay it when the payload hash matches.
				const replay = await readCommittedReceipt(
					repository,
					context,
					action,
					key,
					hash,
				);
				if (replay.found) return replay.result;
			} catch (receiptError) {
				if (
					receiptError instanceof PipelineRuntimeError &&
					(receiptError.code === "IDEMPOTENCY_KEY_REUSED" ||
						receiptError.code === "CORRUPT_PIPELINE_DATA")
				) {
					throw receiptError;
				}
				// Preserve the original operation failure if the best-effort receipt
				// lookup itself is unavailable. The original error is the more actionable
				// and causally correct failure for the caller.
			}
		}
		throw error;
	}
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

function createPipelineRuntimeInternal({ repository }) {
	if (!repository || typeof repository.transaction !== "function") {
		fail("INVALID_REPOSITORY", "Pipeline repository is required");
	}
	return Object.freeze({
		async listPipelines(contextInput) {
			const context = createRuntimeContext(contextInput);
			requirePermission(context, "pipeline.read");
			const values = await repository.listPipelines(context.tenantId);
			if (!Array.isArray(values) || values.length > MAX_PIPELINES_PER_WORKSPACE) {
				fail("CORRUPT_PIPELINE_DATA", "Pipeline list is invalid or exceeds its bound");
			}
			return Object.freeze(
				values.map((value, index) =>
					parseRepositoryPipeline(value, `pipelines[${index}]`),
				),
			);
		},

		async getPipeline(contextInput, pipelineId) {
			const context = createRuntimeContext(contextInput);
			requirePermission(context, "pipeline.read");
			const id = identifier(pipelineId, "INVALID_PIPELINE_ID", "Pipeline ID");
			const value = await repository.getPipeline(context.tenantId, id);
			return value === null ? null : parseRepositoryPipeline(value);
		},

		async getDealAssignment(contextInput, dealId) {
			const context = createRuntimeContext(contextInput);
			requirePermission(context, "pipeline.read");
			const id = identifier(dealId, "INVALID_DEAL_ID", "Deal ID");
			const value = await repository.getAssignment(context.tenantId, id);
			return value === null ? null : parseRepositoryAssignment(value);
		},

		async replayCommand({
			context: contextInput,
			action,
			idempotencyKey: rawKey,
			payload,
		}) {
			const context = createRuntimeContext(contextInput);
			const permission = ACTION_PERMISSIONS[action];
			if (!permission) {
				fail("INVALID_ACTION", "Pipeline command action is not replayable", {
					action,
				});
			}
			requirePermission(context, permission);
			return readCommittedReceipt(
				repository,
				context,
				action,
				idempotencyKey(rawKey),
				payloadHash(payload),
			);
		},

		async createPipeline({
			context: contextInput,
			idempotencyKey: rawKey,
			definition,
			idempotencyPayload,
		}) {
			const context = createRuntimeContext(contextInput);
			requirePermission(context, "pipeline.create");
			if (definition?.tenantId !== context.tenantId) {
				fail("TENANT_MISMATCH", "Pipeline tenant must come from trusted context");
			}
			const pipeline = parsePipelineDefinition(definition);
			if (pipeline.version !== 1) {
				fail(
					"INVALID_INITIAL_VERSION",
					"A new pipeline must start at version 1",
				);
			}
			if (pipeline.isArchived) {
				fail("INVALID_PIPELINE_STATE", "A pipeline cannot be created archived");
			}
			return idempotent(
				repository,
				context,
				"pipeline.create",
				idempotencyKey(rawKey),
				pipeline,
				async (tx) => {
					const existing = await tx.listPipelines(context.tenantId);
					if (!Array.isArray(existing)) {
						fail("CORRUPT_PIPELINE_DATA", "Pipeline list is invalid");
					}
					if (existing.length >= MAX_PIPELINES_PER_WORKSPACE) {
						fail("PIPELINE_LIMIT", "Workspace pipeline limit was reached", {
							maxPipelines: MAX_PIPELINES_PER_WORKSPACE,
						});
					}
					const effective = parsePipelineDefinition({
						...pipeline,
						// The first pipeline is always default. A later create may explicitly
						// become default; the repository performs the atomic hand-off and
						// increments the previous default's optimistic version.
						isDefault: existing.length === 0 || pipeline.isDefault,
						isArchived: false,
					});
					return tx.insertPipeline(effective);
				},
				idempotencyPayload,
			);
		},

		async updatePipeline({
			context: contextInput,
			idempotencyKey: rawKey,
			definition,
			expectedVersion,
			idempotencyPayload,
		}) {
			const context = createRuntimeContext(contextInput);
			requirePermission(context, "pipeline.update");
			if (definition?.tenantId !== context.tenantId) {
				fail("TENANT_MISMATCH", "Pipeline tenant must come from trusted context");
			}
			const version = positiveVersion(expectedVersion);
			const parsed = parsePipelineDefinition(definition);
			if (parsed.version !== version + 1) {
				fail(
					"INVALID_NEXT_VERSION",
					"Updated pipeline version must increment exactly once",
				);
			}
			return idempotent(
				repository,
				context,
				"pipeline.update",
				idempotencyKey(rawKey),
				{ parsed, expectedVersion: version },
				async (tx) => {
					const currentValue = await tx.getPipeline(context.tenantId, parsed.id);
					if (!currentValue) fail("PIPELINE_NOT_FOUND", "Pipeline was not found");
					const current = parseRepositoryPipeline(currentValue);
					if (current.isArchived) {
						fail("PIPELINE_ARCHIVED", "Restore an archived pipeline before editing it");
					}
					if (
						current.isDefault !== parsed.isDefault ||
						current.isArchived !== parsed.isArchived
					) {
						fail(
							"PIPELINE_STATE_CHANGE_REQUIRES_DEDICATED_COMMAND",
							"Default and archive state must use dedicated commands",
						);
					}
					const changedTypeIds = changedStageTypeIds(current, parsed);
					if (changedTypeIds.length > 0) {
						const assigned = await tx.countAssignmentsByStageIds(
							context.tenantId,
							parsed.id,
							changedTypeIds,
						);
						if (assigned > 0) {
							fail(
								"STAGE_TYPE_IN_USE",
								"A stage with assigned deals cannot change outcome type",
								{ stageIds: changedTypeIds },
							);
						}
					}
					return tx.replacePipeline(
						context.tenantId,
						parsed.id,
						version,
						parsed,
					);
				},
				idempotencyPayload,
			);
		},

		async setDefaultPipeline({
			context: contextInput,
			idempotencyKey: rawKey,
			pipelineId,
			expectedVersion,
		}) {
			const context = createRuntimeContext(contextInput);
			requirePermission(context, "pipeline.set_default");
			const id = identifier(pipelineId, "INVALID_PIPELINE_ID", "Pipeline ID");
			const version = positiveVersion(expectedVersion);
			return idempotent(
				repository,
				context,
				"pipeline.set_default",
				idempotencyKey(rawKey),
				{ pipelineId: id, expectedVersion: version },
				(tx) => tx.setDefault(context.tenantId, id, version),
			);
		},

		async seedAssignmentForMigration({ context: contextInput, assignment }) {
			const context = createRuntimeContext(contextInput);
			requirePermission(context, "pipeline.migrate");
			if (assignment?.tenantId !== context.tenantId) {
				fail("TENANT_MISMATCH", "Assignment tenant must come from trusted context");
			}
			const parsed = parseAssignment(assignment);
			return repository.transaction(async (tx) =>
				parseRepositoryAssignment(await tx.insertAssignment(parsed)),
			);
		},

		async transitionDeal({
			context: contextInput,
			idempotencyKey: rawKey,
			dealId,
			targetStageId,
			expectedVersion,
			allowReopen = false,
		}) {
			const context = createRuntimeContext(contextInput);
			requirePermission(context, "deal.transition");
			if (allowReopen) requirePermission(context, "deal.reopen");
			const id = identifier(dealId, "INVALID_DEAL_ID", "Deal ID");
			const target = identifier(
				targetStageId,
				"INVALID_STAGE_ID",
				"Target stage ID",
			);
			const version = positiveVersion(expectedVersion);
			return idempotent(
				repository,
				context,
				"deal.transition",
				idempotencyKey(rawKey),
				{
					dealId: id,
					targetStageId: target,
					expectedVersion: version,
					allowReopen,
				},
				async (tx) => {
					const assignmentValue = await tx.getAssignment(context.tenantId, id);
					if (!assignmentValue) {
						fail("ASSIGNMENT_NOT_FOUND", "Deal pipeline assignment was not found");
					}
					const assignment = parseRepositoryAssignment(assignmentValue);
					const pipelineValue = await tx.getPipeline(
						context.tenantId,
						assignment.pipelineId,
					);
					if (!pipelineValue) fail("PIPELINE_NOT_FOUND", "Pipeline was not found");
					const pipeline = parseRepositoryPipeline(pipelineValue);
					const plan = planDealStageTransition({
						pipeline,
						assignment,
						targetStageId: target,
						expectedVersion: version,
						allowReopen,
					});
					if (!plan.changed) return plan.assignment;
					return tx.replaceAssignment(
						context.tenantId,
						id,
						version,
						plan.assignment,
					);
				},
			);
		},

		async archivePipeline({
			context: contextInput,
			idempotencyKey: rawKey,
			pipelineId,
			expectedVersion,
		}) {
			const context = createRuntimeContext(contextInput);
			requirePermission(context, "pipeline.archive");
			const id = identifier(pipelineId, "INVALID_PIPELINE_ID", "Pipeline ID");
			const version = positiveVersion(expectedVersion);
			return idempotent(
				repository,
				context,
				"pipeline.archive",
				idempotencyKey(rawKey),
				{ pipelineId: id, expectedVersion: version },
				async (tx) => {
					const currentValue = await tx.getPipeline(context.tenantId, id);
					if (!currentValue) fail("PIPELINE_NOT_FOUND", "Pipeline was not found");
					const current = parseRepositoryPipeline(currentValue);
					if (current.version !== version) {
						fail("STALE_PIPELINE", "Pipeline changed after it was read", {
							expectedVersion: version,
							actualVersion: current.version,
						});
					}
					if (current.isArchived) return current;
					if (current.isDefault) {
						fail(
							"DEFAULT_PIPELINE_ARCHIVE",
							"Default pipeline must be replaced before it can be archived",
						);
					}
					if ((await tx.countOpenAssignments(context.tenantId, id)) > 0) {
						fail(
							"OPEN_DEALS_EXIST",
							"Pipeline with open deals cannot be archived",
						);
					}
					return tx.replacePipeline(
						context.tenantId,
						id,
						version,
						parsePipelineDefinition({
							...current,
							isArchived: true,
							version: version + 1,
						}),
					);
				},
			);
		},

		async restorePipeline({
			context: contextInput,
			idempotencyKey: rawKey,
			pipelineId,
			expectedVersion,
		}) {
			const context = createRuntimeContext(contextInput);
			requirePermission(context, "pipeline.restore");
			const id = identifier(pipelineId, "INVALID_PIPELINE_ID", "Pipeline ID");
			const version = positiveVersion(expectedVersion);
			return idempotent(
				repository,
				context,
				"pipeline.restore",
				idempotencyKey(rawKey),
				{ pipelineId: id, expectedVersion: version },
				async (tx) => {
					const currentValue = await tx.getPipeline(context.tenantId, id);
					if (!currentValue) fail("PIPELINE_NOT_FOUND", "Pipeline was not found");
					const current = parseRepositoryPipeline(currentValue);
					if (current.version !== version) {
						fail("STALE_PIPELINE", "Pipeline changed after it was read", {
							expectedVersion: version,
							actualVersion: current.version,
						});
					}
					if (!current.isArchived) return current;
					return tx.replacePipeline(
						context.tenantId,
						id,
						version,
						parsePipelineDefinition({
							...current,
							isArchived: false,
							version: version + 1,
						}),
					);
				},
			);
		},
	});
}

export function createPipelineRuntime(dependencies) {
	const runtime = createPipelineRuntimeInternal(dependencies);
	return Object.freeze(
		Object.fromEntries(
			Object.entries(runtime).map(([name, operation]) => [
				name,
				(...args) => withRuntimeErrorBoundary(() => operation(...args)),
			]),
		),
	);
}
