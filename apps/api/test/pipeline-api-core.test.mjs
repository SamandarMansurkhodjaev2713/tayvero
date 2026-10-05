import assert from "node:assert/strict";
import test from "node:test";
import {
	PipelineApiCoreError,
	canManagePipelines,
	createDeterministicPipelineIdFactory,
	createPipelineDefinition,
	permissionsForWorkspaceRole,
	pipelineCreateCommandPayload,
	pipelineUpdateCommandPayload,
	toPipelineApiModel,
	updatePipelineDefinition,
} from "../src/pipelines/pipeline-api-core.mjs";

function idFactory() {
	let value = 0;
	return () => `generated-${++value}`;
}

function stages() {
	return [
		{
			key: "new",
			name: "New",
			position: 0,
			type: "OPEN",
			probabilityBps: 1_000,
			color: null,
			allowedFromStageKeys: [],
		},
		{
			key: "qualified",
			name: "Qualified",
			position: 1,
			type: "OPEN",
			probabilityBps: 6_000,
			color: "#2563EB",
			allowedFromStageKeys: ["new"],
		},
		{
			key: "won",
			name: "Won",
			position: 2,
			type: "WON",
			probabilityBps: 10_000,
			color: "#16A34A",
			allowedFromStageKeys: ["qualified"],
		},
		{
			key: "lost",
			name: "Lost",
			position: 3,
			type: "LOST",
			probabilityBps: 0,
			color: "#DC2626",
			allowedFromStageKeys: ["new", "qualified"],
		},
	];
}

function createInput(overrides = {}) {
	return {
		idempotencyKey: "pipeline-create:12345678",
		name: "Sales",
		stages: stages(),
		...overrides,
	};
}

function updateInput(current, overrides = {}) {
	return {
		id: current.id,
		idempotencyKey: "pipeline-update:12345678",
		expectedVersion: current.version,
		name: current.name,
		stages: current.stages.map((stage) => ({
			id: stage.id,
			key: stage.key,
			name: stage.name,
			position: stage.position,
			type: stage.type,
			probabilityBps: stage.probabilityBps,
			color: stage.color,
			allowedFromStageKeys: stage.allowedFromStageIds.map(
				(stageId) => current.stages.find((item) => item.id === stageId).key,
			),
		})),
		...overrides,
	};
}

test("maps workspace roles to least-privilege pipeline permissions", () => {
	assert.deepEqual(permissionsForWorkspaceRole("member"), [
		"pipeline.read",
		"deal.transition",
	]);
	assert.equal(canManagePipelines("member"), false);
	assert.equal(canManagePipelines("admin"), true);
	assert.ok(permissionsForWorkspaceRole("owner").includes("pipeline.archive"));
	assert.ok(permissionsForWorkspaceRole("owner").includes("pipeline.restore"));
	assert.throws(() => permissionsForWorkspaceRole("viewer"), PipelineApiCoreError);
});

test("creates deterministic server-owned pipeline and stage identifiers", () => {
	const firstFactory = createDeterministicPipelineIdFactory({
		tenantId: "workspace-1",
		idempotencyKey: "pipeline-create:12345678",
	});
	const secondFactory = createDeterministicPipelineIdFactory({
		tenantId: "workspace-1",
		idempotencyKey: "pipeline-create:12345678",
	});
	const first = createPipelineDefinition({
		tenantId: "workspace-1",
		input: createInput({
			name: "Enterprise Sales",
			slug: "Enterprise Sales",
		}),
		idFactory: firstFactory,
	});
	const second = createPipelineDefinition({
		tenantId: "workspace-1",
		input: createInput({
			name: "Enterprise Sales",
			slug: "Enterprise Sales",
		}),
		idFactory: secondFactory,
	});
	assert.equal(first.id, second.id);
	assert.deepEqual(
		first.stages.map((stage) => stage.id),
		second.stages.map((stage) => stage.id),
	);
	assert.equal(first.tenantId, "workspace-1");
	// Default selection is decided atomically by the runtime after it counts
	// existing pipelines inside the same serializable transaction.
	assert.equal(first.isDefault, false);
	assert.equal(first.slug, "enterprise-sales");
	assert.equal(first.stages[1].allowedFromStageIds[0], first.stages[0].id);
});

test("preserves an explicit default request in the canonical create payload", () => {
	const input = createInput({ isDefault: true });
	const payload = pipelineCreateCommandPayload(input);
	assert.equal(payload.isDefault, true);
	const definitionValue = createPipelineDefinition({
		tenantId: "workspace-1",
		input,
		idFactory: createDeterministicPipelineIdFactory({
			tenantId: "workspace-1",
			idempotencyKey: input.idempotencyKey,
		}),
	});
	assert.equal(definitionValue.isDefault, true);
});

test("different tenants and command keys produce different server IDs", () => {
	const a = createDeterministicPipelineIdFactory({
		tenantId: "workspace-1",
		idempotencyKey: "pipeline-create:12345678",
	});
	const b = createDeterministicPipelineIdFactory({
		tenantId: "workspace-2",
		idempotencyKey: "pipeline-create:12345678",
	});
	const c = createDeterministicPipelineIdFactory({
		tenantId: "workspace-1",
		idempotencyKey: "pipeline-create:87654321",
	});
	assert.notEqual(a("pipeline"), b("pipeline"));
	assert.notEqual(a("pipeline"), c("pipeline"));
});

test("preserves existing stage identity during update and creates only new IDs", () => {
	const factory = idFactory();
	const current = createPipelineDefinition({
		tenantId: "workspace-1",
		input: createInput(),
		idFactory: factory,
	});
	const draft = current.stages.map((stage) => ({
		id: stage.id,
		key: stage.key,
		name: stage.name,
		position: stage.position,
		type: stage.type,
		probabilityBps: stage.probabilityBps,
		color: stage.color,
		allowedFromStageKeys: stage.allowedFromStageIds.map(
			(id) => current.stages.find((item) => item.id === id).key,
		),
	}));
	draft.splice(1, 0, {
		key: "discovery",
		name: "Discovery",
		position: 1,
		type: "OPEN",
		probabilityBps: 4_000,
		color: null,
		allowedFromStageKeys: ["new"],
	});
	const updated = updatePipelineDefinition({
		current,
		input: {
			id: current.id,
			idempotencyKey: "pipeline-update:12345678",
			expectedVersion: 1,
			name: "Sales v2",
			stages: draft.map((stage, position) => ({ ...stage, position })),
		},
		idFactory: factory,
	});
	assert.equal(updated.version, 2);
	assert.equal(
		updated.stages.find((stage) => stage.key === "new").id,
		current.stages.find((stage) => stage.key === "new").id,
	);
	assert.ok(
		updated.stages.find((stage) => stage.key === "discovery").id.startsWith(
			"generated-",
		),
	);
});

test("rejects foreign stage IDs and unknown transition keys", () => {
	const current = createPipelineDefinition({
		tenantId: "workspace-1",
		input: createInput(),
		idFactory: idFactory(),
	});
	assert.throws(
		() =>
			updatePipelineDefinition({
				current,
				input: {
					id: current.id,
					idempotencyKey: "pipeline-update:12345678",
					expectedVersion: 1,
					name: "Sales",
					stages: stages().map((stage, index) => ({
						...stage,
						id: index === 0 ? "foreign-stage" : current.stages[index].id,
					})),
				},
				idFactory: idFactory(),
			}),
		(error) =>
			error instanceof PipelineApiCoreError && error.code === "UNKNOWN_STAGE_ID",
	);
	const invalid = stages();
	invalid[1] = { ...invalid[1], allowedFromStageKeys: ["missing"] };
	assert.throws(
		() =>
			createPipelineDefinition({
				tenantId: "workspace-1",
				input: createInput({ stages: invalid }),
				idFactory: idFactory(),
			}),
		(error) =>
			error instanceof PipelineApiCoreError &&
			error.code === "UNKNOWN_TRANSITION_SOURCE",
	);
});

test("rejects client-owned IDs on create and mismatched pipeline IDs on update", () => {
	const createStages = stages();
	createStages[0] = { ...createStages[0], id: "client-stage" };
	assert.throws(
		() =>
			createPipelineDefinition({
				tenantId: "workspace-1",
				input: createInput({ stages: createStages }),
				idFactory: idFactory(),
			}),
		(error) =>
			error instanceof PipelineApiCoreError &&
			error.code === "UNKNOWN_INPUT_FIELD",
	);
	const current = createPipelineDefinition({
		tenantId: "workspace-1",
		input: createInput(),
		idFactory: idFactory(),
	});
	assert.throws(
		() =>
			updatePipelineDefinition({
				current,
				input: updateInput(current, {
					id: "other-pipeline",
				}),
				idFactory: idFactory(),
			}),
		(error) =>
			error instanceof PipelineApiCoreError &&
			error.code === "PIPELINE_ID_MISMATCH",
	);
});

test("command payload excludes idempotency metadata and is immutable", () => {
	const createInput = {
		idempotencyKey: "pipeline-create:12345678",
		name: "Sales",
		slug: "sales",
		stages: stages(),
	};
	const payload = pipelineCreateCommandPayload(createInput);
	assert.equal("idempotencyKey" in payload, false);
	assert.ok(Object.isFrozen(payload));
	assert.ok(Object.isFrozen(payload.stages));
	const update = pipelineUpdateCommandPayload({
		id: "pipeline-1",
		idempotencyKey: createInput.idempotencyKey,
		expectedVersion: 7,
		name: createInput.name,
		slug: createInput.slug,
		stages: createInput.stages,
	});
	assert.equal(update.id, "pipeline-1");
	assert.equal(update.expectedVersion, 7);
});

test("command payload rejects unknown and accessor-backed input", () => {
	assert.throws(
		() =>
			pipelineCreateCommandPayload({
				name: "Sales",
				stages: stages(),
				workspaceId: "attacker-workspace",
			}),
		(error) =>
			error instanceof PipelineApiCoreError &&
			error.code === "UNKNOWN_INPUT_FIELD",
	);
	const input = createInput();
	Object.defineProperty(input, "slug", {
		enumerable: true,
		get() {
			throw new Error("getter must never run");
		},
	});
	assert.throws(
		() => pipelineCreateCommandPayload(input),
		(error) =>
			error instanceof PipelineApiCoreError &&
			error.code === "UNSAFE_INPUT_PROPERTY",
	);
});

test("API output hides tenant identity and exposes transition keys", () => {
	const definition = createPipelineDefinition({
		tenantId: "secret-workspace",
		input: createInput(),
		idFactory: idFactory(),
	});
	const output = toPipelineApiModel(definition, true);
	assert.equal("tenantId" in output, false);
	assert.deepEqual(output.stages[1].allowedFromStageKeys, ["new"]);
	assert.equal(output.canManage, true);
});
