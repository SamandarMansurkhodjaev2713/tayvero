import assert from "node:assert/strict";
import test from "node:test";
import {
	createMigrationCoordinator,
	createPrismaMigrationRepository,
	MigrationRuntimeError,
} from "../src/index.mjs";

const sourceDigest = "a".repeat(64);
const now = new Date("2026-09-05T12:00:00.000Z");

test("borrowed transaction hands serialization failure to its outer retry owner without querying an aborted transaction", async () => {
	const { client } = fakePrisma();
	let queries = 0;
	client.$transaction = (callback) => callback(client);
	const repository = createPrismaMigrationRepository(client, {
		transactionMaxAttempts: 1,
	});
	await assert.rejects(
		repository.transaction(async () => {
			queries += 1;
			if (queries > 1) throw { code: "P2039", meta: { code: "25P02" } };
			throw { code: "P2034" };
		}),
		(error) => error.code === "TRANSACTION_RETRY_EXHAUSTED",
	);
	assert.equal(queries, 1);
});

test("owned serialization retries use fresh transaction callbacks and do not retry unknown database failures", async () => {
	const { client } = fakePrisma();
	const repository = createPrismaMigrationRepository(client, {
		retryBaseDelayMs: 0,
	});
	let attempts = 0;
	assert.equal(
		await repository.transaction(async () => {
			attempts += 1;
			if (attempts === 1) throw { code: "P2034" };
			return "committed";
		}),
		"committed",
	);
	assert.equal(attempts, 2);
	const unknown = { code: "P2039", meta: { code: "25P02" } };
	let unknownAttempts = 0;
	await assert.rejects(
		repository.transaction(async () => {
			unknownAttempts += 1;
			throw unknown;
		}),
		(error) => error === unknown,
	);
	assert.equal(unknownAttempts, 1);
});

function clone(value) {
	return structuredClone(value);
}

function fakePrisma(overrides = {}) {
	const state = {
		jobs: [],
		batches: [],
		events: [],
	};
	const calls = [];
	let id = 0;
	const match = (row, where = {}) =>
		Object.entries(where).every(([key, value]) => {
			if (value && typeof value === "object" && !Array.isArray(value))
				return true;
			return row[key] === value;
		});
	const select = (row, fields) => {
		if (!fields) return clone(row);
		return Object.fromEntries(
			Object.keys(fields)
				.filter((key) => fields[key])
				.map((key) => [key, clone(row[key])]),
		);
	};

	const delegates = {
		crmMigrationJob: {
			findFirst: async ({ where, select: fields } = {}) => {
				calls.push(["job.findFirst", clone({ where, select: fields })]);
				const row = state.jobs.find((item) => match(item, where));
				return row ? select(row, fields) : null;
			},
			create: async ({ data }) => {
				calls.push(["job.create", clone({ data })]);
				if (
					state.jobs.some(
						(item) =>
							item.workspaceId === data.workspaceId && item.id === data.id,
					)
				)
					throw { code: "P2002" };
				const row = clone(data);
				state.jobs.push(row);
				return clone(row);
			},
			updateMany: async ({ where, data }) => {
				calls.push(["job.updateMany", clone({ where, data })]);
				const rows = state.jobs.filter((item) => match(item, where));
				for (const row of rows) Object.assign(row, clone(data));
				return { count: rows.length };
			},
		},
		crmMigrationBatch: {
			findMany: async ({ where, orderBy } = {}) => {
				calls.push(["batch.findMany", clone({ where, orderBy })]);
				return state.batches
					.filter((item) => match(item, where))
					.sort((a, b) => a.batchIndex - b.batchIndex)
					.map(clone);
			},
			findFirst: async ({ where } = {}) => {
				calls.push(["batch.findFirst", clone({ where })]);
				const row = state.batches.find((item) => match(item, where));
				return row ? clone(row) : null;
			},
			deleteMany: async ({ where }) => {
				calls.push(["batch.deleteMany", clone({ where })]);
				const before = state.batches.length;
				state.batches = state.batches.filter((item) => !match(item, where));
				return { count: before - state.batches.length };
			},
			createMany: async ({ data }) => {
				calls.push(["batch.createMany", clone({ data })]);
				for (const item of data)
					state.batches.push({
						id: `batch-${++id}`,
						createdAt: now,
						updatedAt: now,
						completedAt: null,
						...clone(item),
					});
				return { count: data.length };
			},
			updateMany: async ({ where, data }) => {
				calls.push(["batch.updateMany", clone({ where, data })]);
				const rows = state.batches.filter((item) => match(item, where));
				for (const row of rows)
					Object.assign(row, clone(data), { updatedAt: now });
				return { count: rows.length };
			},
		},
		crmMigrationEvent: {
			create: async ({ data }) => {
				calls.push(["event.create", clone({ data })]);
				const row = { id: `event-${++id}`, ...clone(data) };
				state.events.push(row);
				return clone(row);
			},
			findMany: async ({ where } = {}) =>
				state.events.filter((item) => match(item, where)).map(clone),
		},
	};

	const client = {
		...delegates,
		async $transaction(callback, options) {
			calls.push(["transaction", clone(options)]);
			const snapshot = clone(state);
			try {
				if (overrides.transactionError) throw overrides.transactionError;
				return await callback({ ...delegates });
			} catch (error) {
				state.jobs = snapshot.jobs;
				state.batches = snapshot.batches;
				state.events = snapshot.events;
				throw error;
			}
		},
	};
	return { client, state, calls };
}

function job() {
	return {
		id: "job-1",
		tenantId: "tenant-a",
		createdById: "user-a",
		entityType: "contact",
		sourceFormat: "CSV",
		sourceFilename: "contacts.csv",
		sourceSha256: sourceDigest,
		status: "CREATED",
		version: 1,
		totalRows: 0,
		acceptedRows: 0,
		rejectedRows: 0,
		warningCount: 0,
		lastCompletedBatch: -1,
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
	};
}

test("uses serializable transactions and scopes durable job reads by tenant", async () => {
	const { client, calls } = fakePrisma();
	const repository = createPrismaMigrationRepository(client);
	await repository.transaction(async (tx) => tx.insertJob(job()));
	const loaded = await repository.getJob("tenant-a", "job-1");
	assert.equal(loaded.tenantId, "tenant-a");
	assert.equal(loaded.sourceFilename, "contacts.csv");
	assert.deepEqual(calls.find(([name]) => name === "transaction")[1], {
		isolationLevel: "Serializable",
		maxWait: 5000,
		timeout: 15000,
	});
	assert.deepEqual(calls.find(([name]) => name === "job.findFirst")[1].where, {
		workspaceId: "tenant-a",
		id: "job-1",
	});
});

test("persists batch leases, counters and optimistic versions", async () => {
	const { client, calls } = fakePrisma();
	const repository = createPrismaMigrationRepository(client);
	await repository.transaction(async (tx) => {
		await tx.insertJob(job());
		await tx.replaceBatches("tenant-a", "job-1", [
			{
				index: 0,
				digest: "b".repeat(64),
				count: 10,
				rowStart: 2,
				rowEnd: 11,
				status: "PENDING",
				attempts: 0,
				importedCount: 0,
				rejectedCount: 0,
				leaseOwner: null,
				leaseExpiresAt: null,
				version: 1,
			},
		]);
		const claimed = await tx.updateBatch("tenant-a", "job-1", 0, (current) => ({
			...current,
			status: "RUNNING",
			leaseOwner: "worker-1",
			leaseExpiresAt: "2026-09-05T12:00:30.000Z",
		}));
		assert.equal(claimed.version, 2);
		assert.equal(claimed.leaseOwner, "worker-1");
	});
	const update = calls.find(([name]) => name === "batch.updateMany")[1];
	assert.equal(update.where.version, 1);
	assert.equal(update.data.version, 2);
	assert.equal(update.data.leaseOwner, "worker-1");
});

test("fails closed on a stale batch instead of silently losing a worker update", async () => {
	const { client, state } = fakePrisma();
	const repository = createPrismaMigrationRepository(client);
	await repository.transaction(async (tx) => {
		await tx.insertJob(job());
		await tx.replaceBatches("tenant-a", "job-1", [
			{
				index: 0,
				digest: "b".repeat(64),
				count: 1,
				rowStart: 2,
				rowEnd: 2,
				status: "PENDING",
				attempts: 0,
				importedCount: 0,
				rejectedCount: 0,
				leaseOwner: null,
				leaseExpiresAt: null,
				version: 1,
			},
		]);
		const original = client.crmMigrationBatch.updateMany;
		client.crmMigrationBatch.updateMany = async () => ({ count: 0 });
		await assert.rejects(
			tx.updateBatch("tenant-a", "job-1", 0, (current) => ({
				...current,
				status: "RUNNING",
				leaseOwner: "worker-a",
				leaseExpiresAt: "2026-09-05T12:00:30.000Z",
			})),
			(error) =>
				error instanceof MigrationRuntimeError && error.code === "STALE_BATCH",
		);
		client.crmMigrationBatch.updateMany = original;
	});
	assert.equal(state.batches[0].status, "PENDING");
});

test("persists an append-only runtime event with operational details", async () => {
	const { client, state } = fakePrisma();
	const repository = createPrismaMigrationRepository(client);
	await repository.transaction(async (tx) => {
		await tx.insertJob(job());
		await tx.appendEvent({
			tenantId: "tenant-a",
			jobId: "job-1",
			type: "migration.batch.completed",
			actorId: "user-a",
			batchIndex: 3,
			at: now.toISOString(),
			importedCount: 50,
			rejectedCount: 2,
		});
	});
	assert.equal(state.events.length, 1);
	assert.deepEqual(state.events[0].details, {
		importedCount: 50,
		rejectedCount: 2,
	});
});

test("sanitizes event details to durable JSON and rejects non-serializable values", async () => {
	const { client, state } = fakePrisma();
	const repository = createPrismaMigrationRepository(client);
	await repository.transaction(async (tx) => {
		await tx.insertJob(job());
		await tx.appendEvent({
			tenantId: "tenant-a",
			jobId: "job-1",
			type: "migration.test",
			actorId: "user-a",
			at: now.toISOString(),
			keep: 1,
			omit: undefined,
		});
	});
	assert.deepEqual(state.events[0].details, { keep: 1 });
	await assert.rejects(
		repository.transaction((tx) =>
			tx.appendEvent({
				tenantId: "tenant-a",
				jobId: "job-1",
				type: "migration.test",
				actorId: "user-a",
				at: now.toISOString(),
				invalid: 1n,
			}),
		),
		(error) =>
			error instanceof MigrationRuntimeError &&
			error.code === "INVALID_EVENT_DETAILS",
	);
});

test("coordinator can restart on the Prisma repository without losing durable batch state", async () => {
	const { client, state } = fakePrisma();
	const repositoryA = createPrismaMigrationRepository(client);
	const coordinatorA = createMigrationCoordinator({
		repository: repositoryA,
		clock: () => now,
		idFactory: () => "job-1",
	});
	await coordinatorA.createJob({
		context: { tenantId: "tenant-a", actorId: "user-a" },
		entityType: "contact",
		sourceFormat: "CSV",
		sourceFilename: "contacts.csv",
		sourceSha256: sourceDigest,
	});
	await coordinatorA.attachDryRun({
		context: { tenantId: "tenant-a", actorId: "user-a" },
		jobId: "job-1",
		dryRun: {
			tenantId: "tenant-a",
			entityType: "contact",
			stats: { sourceRows: 2, errorRows: 0, warnings: 0 },
			batches: [
				{
					index: 0,
					count: 2,
					digest: "c".repeat(64),
					records: [
						{ record: { sourceRowNumber: 2 } },
						{ record: { sourceRowNumber: 4 } },
					],
				},
			],
		},
	});
	await coordinatorA.startJob({
		context: { tenantId: "tenant-a", actorId: "user-a" },
		jobId: "job-1",
	});

	const repositoryB = createPrismaMigrationRepository(client);
	const coordinatorB = createMigrationCoordinator({
		repository: repositoryB,
		clock: () => now,
	});
	await coordinatorB.runNextBatch({
		context: { tenantId: "tenant-a", actorId: "user-a" },
		jobId: "job-1",
		workerId: "worker-b",
		importBatch: async () => ({ importedCount: 2, rejectedCount: 0 }),
	});
	const completed = await coordinatorB.runNextBatch({
		context: { tenantId: "tenant-a", actorId: "user-a" },
		jobId: "job-1",
		workerId: "worker-b",
		importBatch: async () => ({ importedCount: 0 }),
	});
	assert.equal(completed.done, true);
	assert.equal(completed.job.status, "COMPLETED");
	assert.equal(state.batches[0].rowStart, 2);
	assert.equal(state.batches[0].rowEnd, 4);
	assert.equal(state.batches[0].importedCount, 2);
	assert.equal(
		new Date(state.batches[0].completedAt).toISOString(),
		now.toISOString(),
	);
	assert.equal(
		state.events.some((event) => event.type === "migration.job.completed"),
		true,
	);
});
