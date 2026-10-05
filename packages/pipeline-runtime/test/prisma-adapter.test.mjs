import assert from "node:assert/strict";
import test from "node:test";
import { RESERVED_STAGE_KEY_PREFIX } from "@crm/pipeline-core";
import {
	createPrismaPipelineRepository,
	PipelineRuntimeError,
} from "../src/index.mjs";

function row(overrides = {}) {
	return {
		id: "pipeline-1",
		workspaceId: "workspace-1",
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
				stageType: "OPEN",
				probabilityBps: 1_000,
				color: null,
				allowedFromStageIds: [],
				version: 1,
			},
			{
				id: "qualified",
				key: "qualified",
				name: "Qualified",
				position: 1,
				stageType: "OPEN",
				probabilityBps: 6_000,
				color: null,
				allowedFromStageIds: ["new"],
				version: 1,
			},
			{
				id: "won",
				key: "won",
				name: "Won",
				position: 2,
				stageType: "WON",
				probabilityBps: 10_000,
				color: null,
				allowedFromStageIds: ["qualified"],
				version: 1,
			},
			{
				id: "lost",
				key: "lost",
				name: "Lost",
				position: 3,
				stageType: "LOST",
				probabilityBps: 0,
				color: null,
				allowedFromStageIds: ["new", "qualified"],
				version: 1,
			},
		],
		...overrides,
	};
}

function fakePrisma(overrides = {}) {
	const calls = [];
	const current = row();
	const transactionFailures = [...(overrides.transactionFailures ?? [])];
	const client = {
		$transaction: async (callback, options) => {
			calls.push(["transaction", options]);
			const failure = transactionFailures.shift();
			if (failure) throw failure;
			return callback(client);
		},
		crmPipeline: {
			count: async (args) => {
				calls.push(["pipeline.count", args]);
				return overrides.pipelineCount ?? 1;
			},
			findMany: async (args) => {
				calls.push(["pipeline.findMany", args]);
				return [current];
			},
			findFirst: async (args) => {
				calls.push(["pipeline.findFirst", args]);
				return overrides.pipelineFindFirst?.(args) ?? current;
			},
			create: async (args) => {
				calls.push(["pipeline.create", args]);
				if (overrides.pipelineCreateError) throw overrides.pipelineCreateError;
				return current;
			},
			updateMany: async (args) => {
				calls.push(["pipeline.updateMany", args]);
				return { count: overrides.pipelineUpdateCount ?? 1 };
			},
		},
		crmPipelineStage: {
			findMany: async () => current.stages,
			update: async (args) => {
				calls.push(["stage.update", args]);
				return {};
			},
			upsert: async (args) => {
				calls.push(["stage.upsert", args]);
				return {};
			},
			deleteMany: async (args) => {
				calls.push(["stage.deleteMany", args]);
				if (overrides.stageDeleteError) throw overrides.stageDeleteError;
				return { count: args.where.id.in.length };
			},
		},
		crmDealPipelineAssignment: {
			count: async (args) => {
				calls.push(["assignment.count", args]);
				return overrides.assignmentCount ?? 0;
			},
			create: async (args) => ({ id: "assignment", ...args.data }),
			findFirst: async () => null,
			updateMany: async () => ({ count: 1 }),
		},
		crmPipelineCommandReceipt: {
			findFirst: async (args) => {
				calls.push(["receipt.findFirst", args]);
				return null;
			},
			create: async (args) => {
				calls.push(["receipt.create", args]);
				return args.data;
			},
		},
		crmPipelineAuditEvent: {
			create: async (args) => {
				calls.push(["audit.create", args]);
				return args.data;
			},
		},
	};
	return { client, calls };
}

function nextPipeline(overrides = {}) {
	const source = row();
	return {
		id: source.id,
		tenantId: source.workspaceId,
		name: source.name,
		slug: source.slug,
		isDefault: source.isDefault,
		isArchived: source.isArchived,
		version: 2,
		stages: source.stages.map((stage) => ({
			id: stage.id,
			key: stage.key,
			name: stage.name,
			position: stage.position,
			type: stage.stageType,
			probabilityBps: stage.probabilityBps,
			color: stage.color,
			allowedFromStageIds: stage.allowedFromStageIds,
		})),
		...overrides,
	};
}

test("maps Prisma pipeline rows into the domain shape", async () => {
	const { client } = fakePrisma();
	const repository = createPrismaPipelineRepository(client);
	const [pipeline] = await repository.listPipelines("workspace-1");
	assert.equal(pipeline.tenantId, "workspace-1");
	assert.equal(pipeline.stages[0].type, "OPEN");
	assert.equal("workspaceId" in pipeline, false);
});

test("scopes every pipeline read by workspace and bounds the list", async () => {
	const { client, calls } = fakePrisma();
	const repository = createPrismaPipelineRepository(client);
	await repository.listPipelines("workspace-1");
	const [, args] = calls.find(([name]) => name === "pipeline.findMany");
	assert.deepEqual(args.where, { workspaceId: "workspace-1" });
	assert.equal(args.take, 201);
});

test("uses serializable interactive transactions", async () => {
	const { client, calls } = fakePrisma();
	const repository = createPrismaPipelineRepository(client);
	assert.equal(await repository.transaction(async () => "ok"), "ok");
	const [, options] = calls.find(([name]) => name === "transaction");
	assert.deepEqual(options, {
		isolationLevel: "Serializable",
		maxWait: 5_000,
		timeout: 15_000,
	});
});

test("retries only bounded Prisma serialization conflicts", async () => {
	const delays = [];
	const { client, calls } = fakePrisma({
		transactionFailures: [{ code: "P2034" }, { code: "P2034" }],
	});
	const repository = createPrismaPipelineRepository(client, {
		retryBaseDelayMs: 10,
		retryMaxDelayMs: 10,
		random: () => 0,
		sleep: async (delay) => delays.push(delay),
	});
	assert.equal(
		await repository.transaction(async () => "committed"),
		"committed",
	);
	assert.equal(calls.filter(([name]) => name === "transaction").length, 3);
	assert.deepEqual(delays, [5, 5]);
});

test("does not retry permanent Prisma errors", async () => {
	const { client, calls } = fakePrisma({
		transactionFailures: [{ code: "P2002" }],
	});
	const repository = createPrismaPipelineRepository(client, {
		retryBaseDelayMs: 0,
		retryMaxDelayMs: 0,
	});
	await assert.rejects(repository.transaction(async () => "never"));
	assert.equal(calls.filter(([name]) => name === "transaction").length, 1);
});

test("maps exhausted serialization retries to a stable runtime error", async () => {
	const { client, calls } = fakePrisma({
		transactionFailures: [
			{ code: "P2034" },
			{ code: "P2034" },
			{ code: "P2034" },
		],
	});
	const repository = createPrismaPipelineRepository(client, {
		transactionMaxAttempts: 3,
		retryBaseDelayMs: 0,
		retryMaxDelayMs: 0,
	});
	await assert.rejects(
		repository.transaction(async () => "never"),
		(error) =>
			error instanceof PipelineRuntimeError &&
			error.code === "TRANSACTION_RETRY_EXHAUSTED" &&
			error.details.attempts === 3,
	);
	assert.equal(calls.filter(([name]) => name === "transaction").length, 3);
});

test("rejects an invalid retry jitter source before sleeping", async () => {
	const { client } = fakePrisma({ transactionFailures: [{ code: "P2034" }] });
	const repository = createPrismaPipelineRepository(client, {
		retryBaseDelayMs: 10,
		retryMaxDelayMs: 10,
		random: () => 1,
		sleep: async () => {
			throw new Error("sleep must not run for invalid jitter");
		},
	});
	await assert.rejects(
		repository.transaction(async () => "never"),
		(error) =>
			error instanceof PipelineRuntimeError &&
			error.code === "PRISMA_ADAPTER_CONFIGURATION",
	);
});

test("persists command receipts and audit events using workspace-owned fields", async () => {
	const { client, calls } = fakePrisma();
	const repository = createPrismaPipelineRepository(client);
	await repository.putReceipt({
		tenantId: "workspace-1",
		action: "pipeline.create",
		idempotencyKey: "request-1234",
		payloadHash: "a".repeat(64),
		result: { id: "pipeline-1" },
	});
	await repository.appendAudit({
		tenantId: "workspace-1",
		actorId: "user-1",
		requestId: "request-1",
		action: "pipeline.create",
		payloadHash: "a".repeat(64),
		outcome: "SUCCESS",
		entityId: "pipeline-1",
	});
	const receipt = calls.find(([name]) => name === "receipt.create")[1].data;
	const audit = calls.find(([name]) => name === "audit.create")[1].data;
	assert.equal(receipt.workspaceId, "workspace-1");
	assert.deepEqual(receipt.resultJson, { id: "pipeline-1" });
	assert.equal(audit.workspaceId, "workspace-1");
});

test("enforces the maximum number of pipelines inside the transaction", async () => {
	const { client } = fakePrisma({ pipelineCount: 200 });
	const repository = createPrismaPipelineRepository(client);
	await assert.rejects(
		repository.transaction((tx) =>
			tx.insertPipeline(nextPipeline({ version: 1 })),
		),
		(error) =>
			error instanceof PipelineRuntimeError && error.code === "PIPELINE_LIMIT",
	);
});

test("atomically hands off the default during pipeline creation", async () => {
	const { client, calls } = fakePrisma({ pipelineCount: 1 });
	const repository = createPrismaPipelineRepository(client);
	await repository.insertPipeline(
		nextPipeline({
			id: "pipeline-2",
			slug: "renewals",
			name: "Renewals",
			version: 1,
			isDefault: true,
		}),
	);
	const demotion = calls.find(([name]) => name === "pipeline.updateMany");
	const creation = calls.find(([name]) => name === "pipeline.create");
	assert.deepEqual(demotion[1].where, {
		workspaceId: "workspace-1",
		isDefault: true,
		isArchived: false,
	});
	assert.deepEqual(demotion[1].data, {
		isDefault: false,
		version: { increment: 1 },
	});
	assert.equal(creation[1].data.isDefault, true);
});

test("maps a duplicate slug to a stable domain error", async () => {
	const { client } = fakePrisma({
		pipelineCount: 1,
		pipelineCreateError: {
			code: "P2002",
			meta: { target: ["workspace_id", "slug"] },
		},
	});
	const repository = createPrismaPipelineRepository(client);
	await assert.rejects(
		repository.insertPipeline(nextPipeline({ version: 1, isDefault: false })),
		(error) =>
			error instanceof PipelineRuntimeError &&
			error.code === "PIPELINE_SLUG_EXISTS",
	);
});

test("neutralizes stage keys and positions before an ordered replacement", async () => {
	const { client, calls } = fakePrisma();
	const repository = createPrismaPipelineRepository(client);
	const next = nextPipeline({
		stages: [
			{ ...nextPipeline().stages[2], position: 0 },
			{ ...nextPipeline().stages[0], position: 1 },
			{ ...nextPipeline().stages[1], position: 2 },
			{ ...nextPipeline().stages[3], position: 3 },
		],
	});
	await repository.replacePipeline("workspace-1", "pipeline-1", 1, next);
	const firstUpsert = calls.findIndex(([name]) => name === "stage.upsert");
	const neutralizations = calls.filter(([name]) => name === "stage.update");
	const lastNeutralize = calls
		.map(([name]) => name)
		.lastIndexOf("stage.update");
	assert.ok(lastNeutralize >= 0 && lastNeutralize < firstUpsert);
	assert.ok(
		neutralizations.every(([, args]) =>
			args.data.key.startsWith(RESERVED_STAGE_KEY_PREFIX),
		),
	);
});

test("blocks removal of a stage that already owns assignments", async () => {
	const { client } = fakePrisma({ assignmentCount: 1 });
	const repository = createPrismaPipelineRepository(client);
	const next = nextPipeline({
		stages: nextPipeline()
			.stages.filter((stage) => stage.id !== "qualified")
			.map((stage, position) => ({
				...stage,
				position,
				allowedFromStageIds: stage.allowedFromStageIds.filter(
					(id) => id !== "qualified",
				),
			})),
	});
	await assert.rejects(
		repository.replacePipeline("workspace-1", "pipeline-1", 1, next),
		(error) =>
			error instanceof PipelineRuntimeError && error.code === "STAGE_IN_USE",
	);
});

test("maps a foreign-key race during stage deletion to STAGE_IN_USE", async () => {
	const { client } = fakePrisma({ stageDeleteError: { code: "P2003" } });
	const repository = createPrismaPipelineRepository(client);
	const next = nextPipeline({
		stages: nextPipeline()
			.stages.filter((stage) => stage.id !== "qualified")
			.map((stage, position) => ({
				...stage,
				position,
				allowedFromStageIds: stage.allowedFromStageIds.filter(
					(id) => id !== "qualified",
				),
			})),
	});
	await assert.rejects(
		repository.replacePipeline("workspace-1", "pipeline-1", 1, next),
		(error) =>
			error instanceof PipelineRuntimeError && error.code === "STAGE_IN_USE",
	);
});

test("sets the default pipeline with an optimistic version predicate", async () => {
	const { client, calls } = fakePrisma({
		pipelineFindFirst: (args) =>
			args.select
				? {
						id: "pipeline-1",
						version: 7,
						isDefault: false,
						isArchived: false,
					}
				: row({ version: 8, isDefault: true }),
	});
	const repository = createPrismaPipelineRepository(client);
	await repository.setDefault("workspace-1", "pipeline-1", 7);
	const updates = calls.filter(([name]) => name === "pipeline.updateMany");
	const promotion = updates.at(-1)[1];
	assert.equal(promotion.where.version, 7);
	assert.equal(promotion.where.workspaceId, "workspace-1");
	assert.equal(promotion.data.version.increment, 1);
});

test("rejects a stale default-pipeline request before changing any defaults", async () => {
	const { client, calls } = fakePrisma({
		pipelineFindFirst: () => ({
			id: "pipeline-1",
			version: 8,
			isDefault: false,
			isArchived: false,
		}),
	});
	const repository = createPrismaPipelineRepository(client);
	await assert.rejects(
		repository.setDefault("workspace-1", "pipeline-1", 7),
		(error) =>
			error instanceof PipelineRuntimeError && error.code === "STALE_PIPELINE",
	);
	assert.equal(
		calls.filter(([name]) => name === "pipeline.updateMany").length,
		0,
	);
});
