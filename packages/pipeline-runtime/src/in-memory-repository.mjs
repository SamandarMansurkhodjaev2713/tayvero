import { parseAssignment, parsePipelineDefinition } from "@crm/pipeline-core";
import { MAX_PIPELINES_PER_WORKSPACE } from "./constants.mjs";
import { fail } from "./errors.mjs";

function copy(value) {
	return value === undefined ? undefined : structuredClone(value);
}

function tupleKey(...parts) {
	return JSON.stringify(parts);
}

function entityKey(tenantId, id) {
	return tupleKey(tenantId, id);
}

function receiptKey(tenantId, action, idempotencyKey) {
	return tupleKey(tenantId, action, idempotencyKey);
}

export class InMemoryPipelineRepository {
	#pipelines = new Map();
	#assignments = new Map();
	#receipts = new Map();
	#audits = [];
	#transactionTail = Promise.resolve();

	async transaction(callback) {
		if (typeof callback !== "function") {
			fail("INVALID_TRANSACTION", "Transaction callback is required");
		}
		let release;
		const previous = this.#transactionTail;
		this.#transactionTail = new Promise((resolve) => {
			release = resolve;
		});
		await previous;
		const snapshot = {
			pipelines: copy(this.#pipelines),
			assignments: copy(this.#assignments),
			receipts: copy(this.#receipts),
			audits: copy(this.#audits),
		};
		try {
			return await callback(this);
		} catch (error) {
			this.#pipelines = snapshot.pipelines;
			this.#assignments = snapshot.assignments;
			this.#receipts = snapshot.receipts;
			this.#audits = snapshot.audits;
			throw error;
		} finally {
			release();
		}
	}

	async listPipelines(tenantId) {
		const values = [...this.#pipelines.values()]
			.filter((pipeline) => pipeline.tenantId === tenantId)
			.sort(
				(left, right) =>
					left.name.localeCompare(right.name) ||
					left.id.localeCompare(right.id),
			);
		if (values.length > MAX_PIPELINES_PER_WORKSPACE) {
			fail(
				"CORRUPT_PIPELINE_DATA",
				"Workspace contains more pipelines than the supported bound",
				{ maxPipelines: MAX_PIPELINES_PER_WORKSPACE },
			);
		}
		return values.map(copy);
	}

	async getPipeline(tenantId, id) {
		return copy(this.#pipelines.get(entityKey(tenantId, id)) ?? null);
	}

	async insertPipeline(input) {
		const pipeline = parsePipelineDefinition(input);
		const storageKey = entityKey(pipeline.tenantId, pipeline.id);
		if (this.#pipelines.has(storageKey)) {
			fail("PIPELINE_EXISTS", "Pipeline already exists");
		}
		const tenantPipelines = [...this.#pipelines.values()].filter(
			(item) => item.tenantId === pipeline.tenantId,
		);
		if (tenantPipelines.length >= MAX_PIPELINES_PER_WORKSPACE) {
			fail("PIPELINE_LIMIT", "Workspace pipeline limit was reached", {
				maxPipelines: MAX_PIPELINES_PER_WORKSPACE,
			});
		}
		if (tenantPipelines.some((item) => item.slug === pipeline.slug)) {
			fail("PIPELINE_SLUG_EXISTS", "Pipeline slug already exists");
		}
		const storedPipeline = {
			...pipeline,
			isDefault: pipeline.isDefault || tenantPipelines.length === 0,
		};
		if (storedPipeline.isDefault) {
			for (const [existingKey, item] of this.#pipelines) {
				if (
					item.tenantId === pipeline.tenantId &&
					item.isDefault &&
					!item.isArchived
				) {
					this.#pipelines.set(existingKey, {
						...item,
						isDefault: false,
						version: item.version + 1,
					});
				}
			}
		}
		this.#pipelines.set(storageKey, copy(storedPipeline));
		return copy(storedPipeline);
	}

	async replacePipeline(tenantId, id, expectedVersion, nextInput) {
		const next = parsePipelineDefinition(nextInput);
		if (next.tenantId !== tenantId || next.id !== id) {
			fail(
				"TENANT_MISMATCH",
				"Replacement identity does not match its selector",
			);
		}
		const storageKey = entityKey(tenantId, id);
		const current = this.#pipelines.get(storageKey);
		if (!current) fail("PIPELINE_NOT_FOUND", "Pipeline was not found");
		if (current.version !== expectedVersion) {
			fail("STALE_PIPELINE", "Pipeline changed after it was read", {
				expectedVersion,
				actualVersion: current.version,
			});
		}
		if (
			next.slug !== current.slug &&
			[...this.#pipelines.values()].some(
				(item) =>
					item.tenantId === tenantId &&
					item.id !== id &&
					item.slug === next.slug,
			)
		) {
			fail("PIPELINE_SLUG_EXISTS", "Pipeline slug already exists");
		}
		const assignedStageIds = new Set(
			[...this.#assignments.values()]
				.filter((item) => item.tenantId === tenantId && item.pipelineId === id)
				.map((item) => item.stageId),
		);
		const nextIds = new Set(next.stages.map((stage) => stage.id));
		for (const stageId of assignedStageIds) {
			if (!nextIds.has(stageId)) {
				fail("STAGE_IN_USE", "A stage with assigned deals cannot be removed", {
					stageId,
				});
			}
		}
		this.#pipelines.set(storageKey, copy(next));
		return copy(next);
	}

	async setDefault(tenantId, pipelineId, expectedVersion) {
		const targetKey = entityKey(tenantId, pipelineId);
		const target = this.#pipelines.get(targetKey);
		if (!target) fail("PIPELINE_NOT_FOUND", "Pipeline was not found");
		if (target.version !== expectedVersion) {
			fail("STALE_PIPELINE", "Pipeline changed after it was read", {
				expectedVersion,
				actualVersion: target.version,
			});
		}
		if (target.isArchived) {
			fail("PIPELINE_ARCHIVED", "Archived pipeline cannot be default");
		}
		if (target.isDefault) return copy(target);

		for (const [storageKey, item] of this.#pipelines) {
			if (item.tenantId !== tenantId) continue;
			const shouldBeDefault = item.id === pipelineId;
			if (item.isDefault === shouldBeDefault) continue;
			this.#pipelines.set(storageKey, {
				...item,
				isDefault: shouldBeDefault,
				version: item.version + 1,
			});
		}
		return copy(this.#pipelines.get(targetKey));
	}

	async countOpenAssignments(tenantId, pipelineId) {
		const pipeline = this.#pipelines.get(entityKey(tenantId, pipelineId));
		if (!pipeline) return 0;
		const openStageIds = new Set(
			pipeline.stages
				.filter((stage) => stage.type === "OPEN")
				.map((stage) => stage.id),
		);
		return [...this.#assignments.values()].filter(
			(item) =>
				item.tenantId === tenantId &&
				item.pipelineId === pipelineId &&
				openStageIds.has(item.stageId),
		).length;
	}

	async countAssignmentsByStageIds(tenantId, pipelineId, stageIds) {
		if (!Array.isArray(stageIds) || stageIds.length === 0) return 0;
		const selected = new Set(stageIds);
		return [...this.#assignments.values()].filter(
			(item) =>
				item.tenantId === tenantId &&
				item.pipelineId === pipelineId &&
				selected.has(item.stageId),
		).length;
	}

	async insertAssignment(input) {
		const assignment = parseAssignment(input);
		const storageKey = entityKey(assignment.tenantId, assignment.dealId);
		if (this.#assignments.has(storageKey)) {
			fail("ASSIGNMENT_EXISTS", "Deal already has a pipeline assignment");
		}
		const pipeline = this.#pipelines.get(
			entityKey(assignment.tenantId, assignment.pipelineId),
		);
		if (
			!pipeline ||
			!pipeline.stages.some((stage) => stage.id === assignment.stageId)
		) {
			fail("PIPELINE_STAGE_NOT_FOUND", "Assignment stage was not found");
		}
		this.#assignments.set(storageKey, copy(assignment));
		return copy(assignment);
	}

	async getAssignment(tenantId, dealId) {
		return copy(this.#assignments.get(entityKey(tenantId, dealId)) ?? null);
	}

	async replaceAssignment(tenantId, dealId, expectedVersion, nextInput) {
		const next = parseAssignment(nextInput);
		if (next.tenantId !== tenantId || next.dealId !== dealId) {
			fail(
				"TENANT_MISMATCH",
				"Assignment identity does not match its selector",
			);
		}
		const storageKey = entityKey(tenantId, dealId);
		const current = this.#assignments.get(storageKey);
		if (!current) {
			fail("ASSIGNMENT_NOT_FOUND", "Deal pipeline assignment was not found");
		}
		if (current.version !== expectedVersion) {
			fail("STALE_ASSIGNMENT", "Deal assignment changed after it was read", {
				expectedVersion,
				actualVersion: current.version,
			});
		}
		const pipeline = this.#pipelines.get(entityKey(tenantId, next.pipelineId));
		if (
			!pipeline ||
			!pipeline.stages.some((stage) => stage.id === next.stageId)
		) {
			fail("PIPELINE_STAGE_NOT_FOUND", "Target pipeline stage was not found");
		}
		this.#assignments.set(storageKey, copy(next));
		return copy(next);
	}

	async getReceipt(tenantId, action, idempotencyKey) {
		return copy(
			this.#receipts.get(receiptKey(tenantId, action, idempotencyKey)) ?? null,
		);
	}

	async putReceipt(receipt) {
		const storageKey = receiptKey(
			receipt.tenantId,
			receipt.action,
			receipt.idempotencyKey,
		);
		if (this.#receipts.has(storageKey)) {
			fail("RECEIPT_EXISTS", "Command receipt already exists");
		}
		this.#receipts.set(storageKey, copy(receipt));
	}

	async appendAudit(event) {
		this.#audits.push(copy(event));
	}

	async audits() {
		return copy(this.#audits);
	}
}
