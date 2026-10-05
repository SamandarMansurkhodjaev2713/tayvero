import test from "node:test";
import assert from "node:assert/strict";
import { createMigrationCoordinator, InMemoryMigrationRepository } from "../src/index.mjs";
async function setup({ maxAttempts = 3 } = {}) {
    let now = new Date("2026-09-13T00:00:00Z");
    const repository = new InMemoryMigrationRepository();
    const coordinator = createMigrationCoordinator({ repository, clock: () => now, leaseMs: 1000, maxAttempts });
    const context = { tenantId: "tenant", actorId: "actor" };
    const job = await coordinator.createJob({ context, jobId: "job", entityType: "contact", sourceFormat: "CSV", sourceFilename: "a.csv", sourceSha256: "a".repeat(64) });
    await coordinator.attachDryRun({ context, jobId: job.id, dryRun: { tenantId: context.tenantId, entityType: "contact", stats: { sourceRows: 1, errorRows: 0, warnings: 0 }, batches: [{ index: 0, count: 1, digest: "b".repeat(64) }] } });
    await coordinator.startJob({ context, jobId: job.id });
    const run = importBatch => coordinator.runNextBatch({ context, jobId: job.id, workerId: "worker-shared", importBatch });
    return { repository, coordinator, context, run, advance: () => { now = new Date(now.getTime() + 2000); } };
}
const turn = () => new Promise(resolve => setImmediate(resolve));
test("migration: a stale claim cannot settle a newer lease even with the same workerId", async () => {
    const s = await setup();
    let releaseFirst, releaseSecond;
    const first = s.run(() => new Promise(resolve => { releaseFirst = () => resolve({ importedCount: 1 }); }));
    await turn();
    s.advance();
    const second = s.run(() => new Promise(resolve => { releaseSecond = () => resolve({ importedCount: 1 }); }));
    await turn();
    const checkFirst = assert.rejects(first, error => error.code === "LEASE_LOST");
    releaseFirst();
    await checkFirst;
    assert.equal((await s.repository.listBatches("tenant", "job"))[0].status, "RUNNING");
    releaseSecond();
    await second;
    assert.equal((await s.repository.getJob("tenant", "job")).acceptedRows, 1);
});
test("migration: process crashes consume attempts and eventually quarantine the batch", async () => {
    const s = await setup({ maxAttempts: 2 });
    let releaseA, releaseB, thirdCalled = false;
    const a = s.run(() => new Promise(resolve => { releaseA = () => resolve({ importedCount: 1 }); }));
    await turn();
    s.advance();
    const b = s.run(() => new Promise(resolve => { releaseB = () => resolve({ importedCount: 1 }); }));
    await turn();
    s.advance();
    const result = await s.run(async () => { thirdCalled = true; return { importedCount: 1 }; });
    assert.equal(thirdCalled, false);
    assert.equal(result.job.status, "FAILED");
    const checkA = assert.rejects(a, e => e.code === "LEASE_LOST");
    const checkB = assert.rejects(b, e => e.code === "LEASE_LOST");
    releaseA();
    releaseB();
    await Promise.all([checkA, checkB]);
    assert.equal((await s.repository.listBatches("tenant", "job"))[0].attempts, 2);
});
test("migration: failure after cancellation cannot overwrite CANCELLED with FAILED", async () => {
    const s = await setup({ maxAttempts: 1 });
    let rejectImport;
    const running = s.run(() => new Promise((_resolve, reject) => { rejectImport = reject; }));
    await turn();
    await s.coordinator.cancelJob({ context: s.context, jobId: "job" });
    const check = assert.rejects(running);
    rejectImport(new Error("late provider failure"));
    await check;
    assert.equal((await s.repository.getJob("tenant", "job")).status, "CANCELLED");
});
test("migration: invalid importer result is a terminal contract error", async () => {
    const s = await setup();
    await assert.rejects(s.run(async () => null), e => e.code === "INVALID_IMPORT_OUTCOME");
    assert.equal((await s.repository.getJob("tenant", "job")).status, "FAILED");
});
test("migration: tenant/job delimiter ambiguity cannot alias storage keys", async () => {
    const repository = new InMemoryMigrationRepository();
    await repository.insertJob({ tenantId: "a:b", id: "c", version: 1 });
    assert.equal(await repository.getJob("a", "b:c"), null);
});
