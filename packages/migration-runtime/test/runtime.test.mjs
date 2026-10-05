import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
	createMigrationCoordinator,
	InMemoryMigrationRepository,
	MigrationRuntimeError,
	transitionStatus,
} from "../src/index.mjs";

const digest = createHash("sha256").update("source").digest("hex");
function ctx(overrides = {}) {
	return { tenantId: "t1", actorId: "u1", ...overrides };
}
function dryRun(overrides = {}) {
	return {
		tenantId: "t1",
		entityType: "contact",
		stats: { sourceRows: 2, errorRows: 0, warnings: 0 },
		batches: [
			{ index: 0, count: 1, digest: "a".repeat(64) },
			{ index: 1, count: 1, digest: "b".repeat(64) },
		],
		...overrides,
	};
}
function expectCode(promise, code) {
	return assert.rejects(
		promise,
		(error) => error instanceof MigrationRuntimeError && error.code === code,
	);
}

async function ready({
	clock = () => new Date("2026-08-31T12:00:00.000Z"),
	maxAttempts = 3,
} = {}) {
	const repository = new InMemoryMigrationRepository();
	const coordinator = createMigrationCoordinator({
		repository,
		clock,
		maxAttempts,
		idFactory: () => "job1",
	});
	await coordinator.createJob({
		context: ctx(),
		entityType: "contact",
		sourceFormat: "CSV",
		sourceFilename: "contacts.csv",
		sourceSha256: digest,
	});
	await coordinator.attachDryRun({
		context: ctx(),
		jobId: "job1",
		dryRun: dryRun(),
	});
	await coordinator.startJob({ context: ctx(), jobId: "job1" });
	return { repository, coordinator };
}

test("rejects invalid state transitions", () =>
	assert.throws(
		() => transitionStatus("CREATED", "COMPLETED"),
		(error) => error.code === "INVALID_JOB_TRANSITION",
	));
test("rejects a dry-run from another tenant", async () => {
	const repository = new InMemoryMigrationRepository();
	const coordinator = createMigrationCoordinator({
		repository,
		idFactory: () => "job1",
	});
	await coordinator.createJob({
		context: ctx(),
		entityType: "contact",
		sourceFormat: "CSV",
		sourceFilename: "contacts.csv",
		sourceSha256: digest,
	});
	await expectCode(
		coordinator.attachDryRun({
			context: ctx(),
			jobId: "job1",
			dryRun: dryRun({ tenantId: "t2" }),
		}),
		"INVALID_DRY_RUN",
	);
});
test("processes bounded batches and completes after the last checkpoint", async () => {
	const { coordinator } = await ready();
	const calls = [];
	const importer = async (input) => {
		calls.push(input);
		return { importedCount: 1, rejectedCount: 0 };
	};
	await coordinator.runNextBatch({
		context: ctx(),
		jobId: "job1",
		workerId: "worker-a",
		importBatch: importer,
	});
	await coordinator.runNextBatch({
		context: ctx(),
		jobId: "job1",
		workerId: "worker-a",
		importBatch: importer,
	});
	const completed = await coordinator.runNextBatch({
		context: ctx(),
		jobId: "job1",
		workerId: "worker-a",
		importBatch: importer,
	});
	assert.equal(completed.done, true);
	assert.equal(completed.job.status, "COMPLETED");
	assert.equal(completed.job.acceptedRows, 2);
	assert.equal(calls.length, 2);
});
test("concurrent workers claim distinct batches and never duplicate the same lease", async () => {
	const { coordinator } = await ready();
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const claimed = [];
	const importer = async (input) => {
		claimed.push(input.batchIndex);
		await gate;
		return { importedCount: 1, rejectedCount: 0 };
	};
	const first = coordinator.runNextBatch({
		context: ctx(),
		jobId: "job1",
		workerId: "worker-a",
		importBatch: importer,
	});
	await new Promise((resolve) => setImmediate(resolve));
	const second = coordinator.runNextBatch({
		context: ctx(),
		jobId: "job1",
		workerId: "worker-b",
		importBatch: importer,
	});
	await new Promise((resolve) => setImmediate(resolve));
	release();
	await Promise.all([first, second]);
	assert.deepEqual(
		claimed.sort((a, b) => a - b),
		[0, 1],
	);
});
test("an expired RUNNING lease is reclaimed with the same operation identity", async () => {
	let current = new Date("2026-08-31T12:00:00.000Z");
	const clock = () => current;
	const repository = new InMemoryMigrationRepository();
	const coordinator = createMigrationCoordinator({
		repository,
		clock,
		leaseMs: 1000,
		idFactory: () => "job1",
	});
	await coordinator.createJob({
		context: ctx(),
		entityType: "contact",
		sourceFormat: "CSV",
		sourceFilename: "contacts.csv",
		sourceSha256: digest,
	});
	await coordinator.attachDryRun({
		context: ctx(),
		jobId: "job1",
		dryRun: {
			...dryRun(),
			stats: { sourceRows: 1, errorRows: 0, warnings: 0 },
			batches: [dryRun().batches[0]],
		},
	});
	await coordinator.startJob({ context: ctx(), jobId: "job1" });
	let release;
	const neverFinished = new Promise((resolve) => {
		release = resolve;
	});
	const first = coordinator.runNextBatch({
		context: ctx(),
		jobId: "job1",
		workerId: "worker-dead",
		importBatch: async () => {
			await neverFinished;
			return { importedCount: 1 };
		},
	});
	await new Promise((resolve) => setImmediate(resolve));
	current = new Date("2026-08-31T12:00:02.000Z");
	const keys = [];
	const recovered = await coordinator.runNextBatch({
		context: ctx(),
		jobId: "job1",
		workerId: "worker-recovery",
		importBatch: async ({ idempotencyKey }) => {
			keys.push(idempotencyKey);
			return { importedCount: 1 };
		},
	});
	assert.equal(recovered.importedCount, 1);
	assert.equal(keys.length, 1);
	release();
	await assert.rejects(first, (error) => error.code === "LEASE_LOST");
});
test("retries a transient failure with the same idempotency key", async () => {
	const { coordinator } = await ready();
	const keys = [];
	let attempt = 0;
	const importer = async ({ idempotencyKey }) => {
		keys.push(idempotencyKey);
		attempt += 1;
		if (attempt === 1) throw new Error("temporary");
		return { importedCount: 1 };
	};
	await assert.rejects(
		coordinator.runNextBatch({
			context: ctx(),
			jobId: "job1",
			workerId: "worker-a",
			importBatch: importer,
		}),
	);
	await coordinator.runNextBatch({
		context: ctx(),
		jobId: "job1",
		workerId: "worker-a",
		importBatch: importer,
	});
	assert.equal(keys[0], keys[1]);
});
test("moves a poison batch and job to FAILED after bounded attempts", async () => {
	const { coordinator } = await ready({ maxAttempts: 2 });
	const importer = async () => {
		throw Object.assign(new Error("permanent"), { code: "PERMANENT" });
	};
	await assert.rejects(
		coordinator.runNextBatch({
			context: ctx(),
			jobId: "job1",
			workerId: "worker-a",
			importBatch: importer,
		}),
	);
	await assert.rejects(
		coordinator.runNextBatch({
			context: ctx(),
			jobId: "job1",
			workerId: "worker-a",
			importBatch: importer,
		}),
	);
	await expectCode(
		coordinator.runNextBatch({
			context: ctx(),
			jobId: "job1",
			workerId: "worker-a",
			importBatch: importer,
		}),
		"JOB_NOT_IMPORTING",
	);
});
test("cancellation is terminal and prevents execution", async () => {
	const repository = new InMemoryMigrationRepository();
	const coordinator = createMigrationCoordinator({
		repository,
		idFactory: () => "job1",
	});
	await coordinator.createJob({
		context: ctx(),
		entityType: "contact",
		sourceFormat: "CSV",
		sourceFilename: "contacts.csv",
		sourceSha256: digest,
	});
	const cancelled = await coordinator.cancelJob({
		context: ctx(),
		jobId: "job1",
	});
	assert.equal(cancelled.status, "CANCELLED");
	await expectCode(
		coordinator.startJob({ context: ctx(), jobId: "job1" }),
		"INVALID_JOB_TRANSITION",
	);
});

test("rejects a dry-run for a different entity type", async () => {
	const repository = new InMemoryMigrationRepository();
	const coordinator = createMigrationCoordinator({
		repository,
		idFactory: () => "job1",
	});
	await coordinator.createJob({
		context: ctx(),
		entityType: "contact",
		sourceFormat: "CSV",
		sourceFilename: "contacts.csv",
		sourceSha256: digest,
	});
	await expectCode(
		coordinator.attachDryRun({
			context: ctx(),
			jobId: "job1",
			dryRun: dryRun({ entityType: "company" }),
		}),
		"DRY_RUN_ENTITY_MISMATCH",
	);
});

test("rejects non-contiguous batch indexes and count drift", async () => {
	const repository = new InMemoryMigrationRepository();
	const coordinator = createMigrationCoordinator({
		repository,
		idFactory: () => "job1",
	});
	await coordinator.createJob({
		context: ctx(),
		entityType: "contact",
		sourceFormat: "CSV",
		sourceFilename: "contacts.csv",
		sourceSha256: digest,
	});
	await expectCode(
		coordinator.attachDryRun({
			context: ctx(),
			jobId: "job1",
			dryRun: dryRun({
				batches: [{ index: 1, count: 2, digest: "a".repeat(64) }],
			}),
		}),
		"INVALID_BATCH_SEQUENCE",
	);

	const repository2 = new InMemoryMigrationRepository();
	const coordinator2 = createMigrationCoordinator({
		repository: repository2,
		idFactory: () => "job2",
	});
	await coordinator2.createJob({
		context: ctx(),
		entityType: "contact",
		sourceFormat: "CSV",
		sourceFilename: "contacts.csv",
		sourceSha256: digest,
	});
	await expectCode(
		coordinator2.attachDryRun({
			context: ctx(),
			jobId: "job2",
			dryRun: dryRun({
				batches: [{ index: 0, count: 1, digest: "a".repeat(64) }],
			}),
		}),
		"DRY_RUN_COUNT_MISMATCH",
	);
});

test("rejects unsafe source filenames before persistence", async () => {
	const repository = new InMemoryMigrationRepository();
	const coordinator = createMigrationCoordinator({
		repository,
		idFactory: () => "job1",
	});
	for (const sourceFilename of [
		"../contacts.csv",
		"folder/contacts.csv",
		"folder\\contacts.csv",
		"..",
		"bad\0name.csv",
	]) {
		await expectCode(
			coordinator.createJob({
				context: ctx(),
				entityType: "contact",
				sourceFormat: "CSV",
				sourceFilename,
				sourceSha256: digest,
			}),
			"INVALID_SOURCE_FILENAME",
		);
	}
});

test("fails immediately when importer counters do not reconcile to the claimed batch", async () => {
	const { coordinator, repository } = await ready({ maxAttempts: 5 });
	await expectCode(
		coordinator.runNextBatch({
			context: ctx(),
			jobId: "job1",
			workerId: "worker-a",
			importBatch: async () => ({ importedCount: 2, rejectedCount: 0 }),
		}),
		"BATCH_OUTCOME_COUNT_MISMATCH",
	);
	const job = await repository.getJob("t1", "job1");
	const [batch] = await repository.listBatches("t1", "job1");
	const events = await repository.events();
	assert.equal(job.status, "FAILED");
	assert.equal(batch.status, "FAILED");
	assert.equal(batch.attempts, 1);
	assert.equal(events.at(-1).type, "migration.batch.failed");
	assert.equal(events.at(-1).errorCode, "BATCH_OUTCOME_COUNT_MISMATCH");
});
