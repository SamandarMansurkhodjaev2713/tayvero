import assert from "node:assert/strict";
import test from "node:test";
import { parsePipelineDefinition } from "@crm/pipeline-core";
import {
	InMemoryPipelineRepository,
	PipelineRuntimeError,
	canonicalJson,
	createPipelineRuntime,
	payloadHash,
} from "../src/index.mjs";

function definition(overrides = {}) {
	return {
		id: "p1",
		tenantId: "t1",
		name: "Sales",
		slug: "sales",
		isDefault: true,
		isArchived: false,
		version: 1,
		stages: [
			{
				id: "new",
				key: "new",
				name: "New",
				position: 0,
				type: "OPEN",
				probabilityBps: 1_000,
				allowedFromStageIds: [],
			},
			{
				id: "qualified",
				key: "qualified",
				name: "Qualified",
				position: 1,
				type: "OPEN",
				probabilityBps: 6_000,
				allowedFromStageIds: ["new"],
			},
			{
				id: "won",
				key: "won",
				name: "Won",
				position: 2,
				type: "WON",
				probabilityBps: 10_000,
				allowedFromStageIds: ["qualified"],
			},
			{
				id: "lost",
				key: "lost",
				name: "Lost",
				position: 3,
				type: "LOST",
				probabilityBps: 0,
				allowedFromStageIds: ["new", "qualified"],
			},
		],
		...overrides,
	};
}

function context(overrides = {}) {
	return {
		tenantId: "t1",
		actorId: "u1",
		requestId: "req-123456",
		permissions: [
			"pipeline.read",
			"pipeline.create",
			"pipeline.update",
			"pipeline.set_default",
			"pipeline.archive",
			"pipeline.restore",
			"pipeline.migrate",
			"deal.transition",
			"deal.reopen",
		],
		...overrides,
	};
}

function expectCode(promise, code) {
	return assert.rejects(
		promise,
		(error) => error instanceof PipelineRuntimeError && error.code === code,
	);
}

test("creates an idempotent pipeline and writes one audit event", async () => {
	const repository = new InMemoryPipelineRepository();
	const runtime = createPipelineRuntime({ repository });
	const command = {
		context: context(),
		idempotencyKey: "create-pipeline-0001",
		definition: definition(),
	};
	const first = await runtime.createPipeline(command);
	const second = await runtime.createPipeline(command);
	assert.deepEqual(second, first);
	assert.equal((await repository.audits()).length, 1);
});

test("forces the first pipeline to default even when the caller does not request it", async () => {
	const repository = new InMemoryPipelineRepository();
	const runtime = createPipelineRuntime({ repository });
	const created = await runtime.createPipeline({
		context: context(),
		idempotencyKey: "create-pipeline-first-nondefault",
		definition: definition({ isDefault: false }),
	});
	assert.equal(created.isDefault, true);
});

test("atomically promotes an explicitly default second pipeline during creation", async () => {
	const repository = new InMemoryPipelineRepository();
	const runtime = createPipelineRuntime({ repository });
	await runtime.createPipeline({
		context: context(),
		idempotencyKey: "create-pipeline-default-first",
		definition: definition({ isDefault: false }),
	});
	const promoted = await runtime.createPipeline({
		context: context(),
		idempotencyKey: "create-pipeline-default-second",
		definition: definition({
			id: "p2",
			name: "Renewals",
			slug: "renewals",
			isDefault: true,
		}),
	});
	const pipelines = await runtime.listPipelines(context());
	const previous = pipelines.find((pipeline) => pipeline.id === "p1");
	assert.equal(promoted.isDefault, true);
	assert.equal(previous.isDefault, false);
	assert.equal(previous.version, 2);
	assert.equal(pipelines.filter((pipeline) => pipeline.isDefault).length, 1);
});

test("keeps an explicitly non-default later pipeline non-default", async () => {
	const repository = new InMemoryPipelineRepository();
	const runtime = createPipelineRuntime({ repository });
	await runtime.createPipeline({
		context: context(),
		idempotencyKey: "create-pipeline-existing-default",
		definition: definition({ isDefault: false }),
	});
	const created = await runtime.createPipeline({
		context: context(),
		idempotencyKey: "create-pipeline-later-nondefault",
		definition: definition({
			id: "p2",
			name: "Renewals",
			slug: "renewals",
			isDefault: false,
		}),
	});
	const pipelines = await runtime.listPipelines(context());
	assert.equal(created.isDefault, false);
	assert.equal(pipelines.find((pipeline) => pipeline.id === "p1").isDefault, true);
	assert.equal(pipelines.find((pipeline) => pipeline.id === "p1").version, 1);
});

test("replays a concurrently committed command after a deterministic mutation race", async () => {
	const committed = definition();
	const normalizedCommand = parsePipelineDefinition(committed);
	const repository = {
		async transaction(callback) {
			return callback({
				getReceipt: async () => null,
				listPipelines: async () => [],
				insertPipeline: async () => {
					throw new PipelineRuntimeError(
						"PIPELINE_EXISTS",
						"A concurrent request already inserted this pipeline",
					);
				},
				appendAudit: async () => {
					throw new Error("audit must not run in the losing transaction");
				},
				putReceipt: async () => {
					throw new Error("receipt must not be written by the losing transaction");
				},
			});
		},
		async getReceipt(tenantId, action, idempotencyKey) {
			assert.equal(tenantId, "t1");
			assert.equal(action, "pipeline.create");
			assert.equal(idempotencyKey, "create-concurrent-0001");
			return {
				tenantId,
				action,
				idempotencyKey,
				payloadHash: payloadHash(normalizedCommand),
				result: committed,
			};
		},
	};
	const runtime = createPipelineRuntime({ repository });
	const result = await runtime.createPipeline({
		context: context(),
		idempotencyKey: "create-concurrent-0001",
		definition: committed,
	});
	assert.deepEqual(result, normalizedCommand);
});

test("canonical payload hashing never invokes object or array accessors", () => {
	let getterInvoked = false;
	const objectPayload = {};
	Object.defineProperty(objectPayload, "secret", {
		enumerable: true,
		get() {
			getterInvoked = true;
			return "must-not-run";
		},
	});
	assert.throws(
		() => canonicalJson(objectPayload),
		(error) =>
			error instanceof PipelineRuntimeError &&
			error.code === "UNSAFE_PAYLOAD_PROPERTY",
	);
	assert.equal(getterInvoked, false);

	const arrayPayload = ["safe"];
	Object.defineProperty(arrayPayload, "0", {
		enumerable: true,
		get() {
			getterInvoked = true;
			return "must-not-run";
		},
	});
	assert.throws(
		() => canonicalJson(arrayPayload),
		(error) =>
			error instanceof PipelineRuntimeError &&
			error.code === "UNSAFE_PAYLOAD_PROPERTY",
	);
	assert.equal(getterInvoked, false);
});

test("canonical payload hashing rejects cycles, sparse arrays and custom serialization", () => {
	const cyclic = [];
	cyclic.push(cyclic);
	assert.throws(
		() => canonicalJson(cyclic),
		(error) =>
			error instanceof PipelineRuntimeError && error.code === "CYCLIC_PAYLOAD",
	);

	const sparse = new Array(2);
	sparse[1] = "value";
	assert.throws(
		() => canonicalJson(sparse),
		(error) =>
			error instanceof PipelineRuntimeError &&
			error.code === "UNSAFE_PAYLOAD_PROPERTY",
	);

	assert.throws(
		() => canonicalJson({ toJSON() { return { forged: true }; } }),
		(error) =>
			error instanceof PipelineRuntimeError &&
			error.code === "UNSUPPORTED_PAYLOAD_VALUE",
	);
});

test("replays a command by its stable API payload before service-side reads", async () => {
	const repository = new InMemoryPipelineRepository();
	const runtime = createPipelineRuntime({ repository });
	const apiPayload = {
		name: "Sales",
		slug: "sales",
		isDefault: true,
		stages: [{ key: "new" }],
	};
	await runtime.createPipeline({
		context: context(),
		idempotencyKey: "create-pipeline-0001",
		definition: definition(),
		idempotencyPayload: apiPayload,
	});
	const replay = await runtime.replayCommand({
		context: context(),
		action: "pipeline.create",
		idempotencyKey: "create-pipeline-0001",
		payload: apiPayload,
	});
	assert.equal(replay.found, true);
	assert.equal(replay.result.id, "p1");
	await expectCode(
		runtime.replayCommand({
			context: context(),
			action: "pipeline.create",
			idempotencyKey: "create-pipeline-0001",
			payload: { ...apiPayload, name: "Changed" },
		}),
		"IDEMPOTENCY_KEY_REUSED",
	);
});

test("rejects an idempotency key reused with another payload", async () => {
	const repository = new InMemoryPipelineRepository();
	const runtime = createPipelineRuntime({ repository });
	await runtime.createPipeline({
		context: context(),
		idempotencyKey: "create-pipeline-0001",
		definition: definition(),
	});
	await expectCode(
		runtime.createPipeline({
			context: context(),
			idempotencyKey: "create-pipeline-0001",
			definition: definition({ name: "Other" }),
		}),
		"IDEMPOTENCY_KEY_REUSED",
	);
});

test("rejects tenant ownership supplied for another tenant", async () => {
	const runtime = createPipelineRuntime({
		repository: new InMemoryPipelineRepository(),
	});
	await expectCode(
		runtime.createPipeline({
			context: context(),
			idempotencyKey: "create-pipeline-0001",
			definition: definition({ tenantId: "t2" }),
		}),
		"TENANT_MISMATCH",
	);
});

test("normalizes pipeline-domain validation failures at the runtime boundary", async () => {
	const runtime = createPipelineRuntime({
		repository: new InMemoryPipelineRepository(),
	});
	await expectCode(
		runtime.createPipeline({
			context: context(),
			idempotencyKey: "create-pipeline-0001",
			definition: definition({ stages: definition().stages.slice(0, 2) }),
		}),
		"STAGE_COUNT",
	);
});

test("enforces action permission at the operation boundary", async () => {
	const runtime = createPipelineRuntime({
		repository: new InMemoryPipelineRepository(),
	});
	await expectCode(
		runtime.createPipeline({
			context: context({ permissions: ["pipeline.read"] }),
			idempotencyKey: "create-pipeline-0001",
			definition: definition(),
		}),
		"PERMISSION_DENIED",
	);
});

test("transitions a seeded deal with optimistic concurrency", async () => {
	const repository = new InMemoryPipelineRepository();
	const runtime = createPipelineRuntime({ repository });
	await runtime.createPipeline({
		context: context(),
		idempotencyKey: "create-pipeline-0001",
		definition: definition(),
	});
	await runtime.seedAssignmentForMigration({
		context: context(),
		assignment: {
			tenantId: "t1",
			dealId: "d1",
			pipelineId: "p1",
			stageId: "new",
			version: 1,
		},
	});
	const moved = await runtime.transitionDeal({
		context: context(),
		idempotencyKey: "move-deal-0000001",
		dealId: "d1",
		targetStageId: "qualified",
		expectedVersion: 1,
	});
	assert.equal(moved.stageId, "qualified");
	assert.equal(moved.version, 2);
	await expectCode(
		runtime.transitionDeal({
			context: context(),
			idempotencyKey: "move-deal-0000002",
			dealId: "d1",
			targetStageId: "lost",
			expectedVersion: 1,
		}),
		"STALE_ASSIGNMENT",
	);
});

test("serializes two concurrent transitions so only one stale version wins", async () => {
	const repository = new InMemoryPipelineRepository();
	const runtime = createPipelineRuntime({ repository });
	await runtime.createPipeline({
		context: context(),
		idempotencyKey: "create-pipeline-0001",
		definition: definition(),
	});
	await runtime.seedAssignmentForMigration({
		context: context(),
		assignment: {
			tenantId: "t1",
			dealId: "d1",
			pipelineId: "p1",
			stageId: "new",
			version: 1,
		},
	});
	const results = await Promise.allSettled([
		runtime.transitionDeal({
			context: context(),
			idempotencyKey: "move-concurrent-a",
			dealId: "d1",
			targetStageId: "qualified",
			expectedVersion: 1,
		}),
		runtime.transitionDeal({
			context: context(),
			idempotencyKey: "move-concurrent-b",
			dealId: "d1",
			targetStageId: "lost",
			expectedVersion: 1,
		}),
	]);
	assert.equal(
		results.filter((result) => result.status === "fulfilled").length,
		1,
	);
	assert.equal(
		results.filter((result) => result.status === "rejected").length,
		1,
	);
});

test("prevents deleting a stage that still owns a deal assignment", async () => {
	const repository = new InMemoryPipelineRepository();
	const runtime = createPipelineRuntime({ repository });
	await runtime.createPipeline({
		context: context(),
		idempotencyKey: "create-pipeline-0001",
		definition: definition(),
	});
	await runtime.seedAssignmentForMigration({
		context: context(),
		assignment: {
			tenantId: "t1",
			dealId: "d1",
			pipelineId: "p1",
			stageId: "new",
			version: 1,
		},
	});
	const next = definition({
		version: 2,
		stages: definition()
			.stages.filter((stage) => stage.id !== "new")
			.map((stage, index) => ({
				...stage,
				position: index,
				allowedFromStageIds: stage.allowedFromStageIds.filter(
					(id) => id !== "new",
				),
			})),
	});
	await expectCode(
		runtime.updatePipeline({
			context: context(),
			idempotencyKey: "update-pipeline-01",
			definition: next,
			expectedVersion: 1,
		}),
		"STAGE_IN_USE",
	);
});

test("atomically switches the default pipeline with optimistic concurrency", async () => {
	const repository = new InMemoryPipelineRepository();
	const runtime = createPipelineRuntime({ repository });
	await runtime.createPipeline({
		context: context(),
		idempotencyKey: "create-pipeline-0001",
		definition: definition(),
	});
	await runtime.createPipeline({
		context: context(),
		idempotencyKey: "create-pipeline-0002",
		definition: definition({
			id: "p2",
			slug: "renewals",
			name: "Renewals",
			isDefault: false,
		}),
	});
	await expectCode(
		runtime.setDefaultPipeline({
			context: context(),
			idempotencyKey: "default-pipeline-stale",
			pipelineId: "p2",
			expectedVersion: 2,
		}),
		"STALE_PIPELINE",
	);
	await runtime.setDefaultPipeline({
		context: context(),
		idempotencyKey: "default-pipeline-01",
		pipelineId: "p2",
		expectedVersion: 1,
	});
	const pipelines = await runtime.listPipelines(context());
	assert.equal(pipelines.filter((pipeline) => pipeline.isDefault).length, 1);
	assert.equal(pipelines.find((pipeline) => pipeline.isDefault).id, "p2");
});

test("restore requires its own permission rather than archive permission", async () => {
	const repository = new InMemoryPipelineRepository();
	const runtime = createPipelineRuntime({ repository });
	await runtime.createPipeline({
		context: context(),
		idempotencyKey: "create-pipeline-0001",
		definition: definition(),
	});
	await runtime.createPipeline({
		context: context(),
		idempotencyKey: "create-pipeline-0002",
		definition: definition({
			id: "p2",
			name: "Renewals",
			slug: "renewals",
			isDefault: false,
		}),
	});
	await runtime.archivePipeline({
		context: context(),
		idempotencyKey: "archive-pipeline-01",
		pipelineId: "p2",
		expectedVersion: 1,
	});
	await expectCode(
		runtime.restorePipeline({
			context: context({
				permissions: ["pipeline.read", "pipeline.archive"],
			}),
			idempotencyKey: "restore-pipeline-01",
			pipelineId: "p2",
			expectedVersion: 2,
		}),
		"PERMISSION_DENIED",
	);
});

test("in-memory keys do not collide when tenant and entity IDs contain colons", async () => {
	const repository = new InMemoryPipelineRepository();
	await repository.insertPipeline(
		definition({ id: "b:c", tenantId: "a", slug: "first" }),
	);
	await repository.insertPipeline(
		definition({ id: "c", tenantId: "a:b", slug: "second" }),
	);
	assert.equal((await repository.getPipeline("a", "b:c")).slug, "first");
	assert.equal((await repository.getPipeline("a:b", "c")).slug, "second");
});

test("enforces the bounded pipeline count", async () => {
	const repository = new InMemoryPipelineRepository();
	for (let index = 0; index < 200; index += 1) {
		await repository.insertPipeline(
			definition({
				id: `p-${index}`,
				slug: `pipeline-${index}`,
				name: `Pipeline ${index}`,
				isDefault: index === 0,
			}),
		);
	}
	await assert.rejects(
		repository.insertPipeline(
			definition({
				id: "p-overflow",
				slug: "overflow",
				name: "Overflow",
				isDefault: false,
			}),
		),
		(error) => error instanceof PipelineRuntimeError && error.code === "PIPELINE_LIMIT",
	);
});
