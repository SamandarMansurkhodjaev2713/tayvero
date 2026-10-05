/** Real DB tests: this suite is deliberately excluded from the dependency-free test runner.
 * Execute only via gate:operations-postgres on a disposable explicit TEST_DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "@crm/db";
import { resolveTestDatabase } from "@crm/db/test-database";
import { createEncryptedFileSourceStore } from "../../../packages/migration-runtime/src/source-store.mjs";
import { createPrismaApprovalLifecycle } from "../../../packages/agent-action-runtime/src/approval-lifecycle.mjs";
import { createApprovalContinuationStore } from "../../../packages/agent-action-runtime/src/approval-continuation.mjs";
import { sha256Hex } from "@crm/agent-action-runtime/digest";
import { createMigrationApplication } from "../src/migrations/migration-application.mjs";
resolveTestDatabase(process.env);
if (process.env.NODE_ENV !== "test")
    throw new Error("NODE_ENV=test is required");
const suffix = randomUUID();
const workspaceId = `ops-test-${suffix}`;
const authorId = `author-${suffix}`;
const approverId = `approver-${suffix}`;
const context = { tenantId: workspaceId, actorId: authorId };
const admin = { tenantId: workspaceId, actorId: approverId };
const mapping = [{ source: "Name", target: "firstName" }, { source: "Email", target: "email" }];
const keys = { v1: new Uint8Array(32).fill(33) };
let root: string;
let store: Awaited<ReturnType<typeof createEncryptedFileSourceStore>>;
let application: ReturnType<typeof createMigrationApplication>;
const make = () => createMigrationApplication({ db, workspaceId, sourceStore: store, enabled: true, executeEnabled: true });
async function prepare(tag: string, rows = 2) {
    const csv = `Name,Email\n${Array.from({ length: rows }, (_, i) => `Person ${i},${tag}-${i}-${suffix}@example.test`).join("\n")}\n`;
    const uploaded = await application.upload(context, { filename: `${tag}.csv`, mimeType: "text/csv", base64: Buffer.from(csv).toString("base64") });
    const input = { sourceId: uploaded.source.id, expectedSha256: uploaded.source.sha256, entityType: "contact" as const, mapping, commandId: `cmd-${tag}` };
    const job = await application.prepare(context, input);
    return { ...job, uploaded, input };
}
async function finish(jobId: string) {
    for (let step = 0; step < 30; step++) {
        const result = await application.executeNext(context, { jobId });
        if (result.status === "COMPLETED")
            return;
        if (result.status === "FAILED")
            throw new Error("Database import failed");
        if (result.busy)
            await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Import exceeded finite acceptance bound");
}
beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "tayvero-operations-pg-"));
    store = await createEncryptedFileSourceStore({ root, keys, activeKeyId: "v1" });
    await db.user.createMany({ data: [
            { id: authorId, name: "Import fixture author", email: `author-${suffix}@example.test` },
            { id: approverId, name: "Independent fixture approver", email: `approver-${suffix}@example.test` },
        ] });
    await db.organization.create({ data: { id: workspaceId, name: "Operations DB acceptance", slug: workspaceId, createdAt: new Date() } });
    await db.member.createMany({ data: [
            { id: `member-a-${suffix}`, organizationId: workspaceId, userId: authorId, role: "admin", createdAt: new Date() },
            { id: `member-b-${suffix}`, organizationId: workspaceId, userId: approverId, role: "owner", createdAt: new Date() },
        ] });
    await db.agentDefinition.create({ data: { id: `continuation-agent-${suffix}`, name: "Continuation acceptance", status: "LIVE", createdById: authorId } });
    await db.agentVersion.create({ data: { id: `continuation-version-${suffix}`, agentId: `continuation-agent-${suffix}`, number: 1, status: "DEPLOYED",
      instructions: "Only fixture operations", manifest: {}, modelId: "fixture-not-a-provider", sandboxPolicy: {}, createdById: authorId } });
    application = make();
});
afterAll(async () => {
    // Only unique fixture-owned rows are touched. No TRUNCATE or test-wide reset.
    await db.crmMigrationRowReceipt.deleteMany({ where: { workspaceId } });
    await db.crmMigrationJob.deleteMany({ where: { workspaceId } });
    await db.crmMigrationSourceEvent.deleteMany({ where: { workspaceId } });
    await db.crmMigrationSource.deleteMany({ where: { workspaceId } });
    await db.governedActionContinuation.deleteMany({ where: { workspaceId } });
    await db.governedActionApproval.deleteMany({ where: { workspaceId } });
    await db.governedActionReceipt.deleteMany({ where: { workspaceId } });
    await db.agentRun.deleteMany({ where: { agentId: `continuation-agent-${suffix}` } });
    await db.agentVersion.deleteMany({ where: { agentId: `continuation-agent-${suffix}` } });
    await db.agentDefinition.deleteMany({ where: { id: `continuation-agent-${suffix}` } });
    await db.governedActionAuditEvent.deleteMany({ where: { workspaceId } });
    await db.contact.deleteMany({ where: { ownerId: authorId, source: "IMPORT" } });
    await db.company.deleteMany({ where: { ownerId: authorId, source: "IMPORT" } });
    await db.organization.deleteMany({ where: { id: workspaceId } });
    await db.user.deleteMany({ where: { id: { in: [authorId, approverId] } } });
    if (root)
        await rm(root, { recursive: true, force: true });
});
describe("Migration source and receipts — actual PostgreSQL", () => {
    it("restores encrypted source and the same command across independent service instances", async () => {
        const p = await prepare("restart");
        const restartedStore = await createEncryptedFileSourceStore({ root, keys, activeKeyId: "v1" });
        const restarted = createMigrationApplication({ db, workspaceId, sourceStore: restartedStore, enabled: true, executeEnabled: true });
        const again = await restarted.prepare(context, p.input);
        expect(again.jobId).toBe(p.jobId);
        const preview = await restarted.preview(context, { sourceId: p.uploaded.source.id, expectedSha256: p.uploaded.source.sha256 });
        expect(preview.preview.totalRows).toBe(2);
    });
    it("commits row receipts with CRM writes and replay never creates duplicates", async () => {
        const p = await prepare("replay");
        await finish(p.jobId);
        await make().executeNext(context, { jobId: p.jobId });
        const report = await application.report(context, { jobId: p.jobId, afterRow: 0 });
        expect(report.created).toBe(2);
        expect(report.reconciliation.ok).toBe(true);
        expect(await db.crmMigrationRowReceipt.count({ where: { workspaceId, jobId: p.jobId } })).toBe(2);
        const q = await application.prepare(context, { ...p.input, commandId: "reimport-same-bytes" });
        await finish(q.jobId);
        const duplicate = await application.report(context, { jobId: q.jobId, afterRow: 0 });
        expect(duplicate.duplicates).toBe(2);
        expect(duplicate.created).toBe(0);
    });
    it("serializes competing import commands and produces one persisted intent", async () => {
        const p = await prepare("simultaneous");
        const input = { ...p.input, commandId: "parallel-command" };
        const [first, second] = await Promise.all([application.prepare(context, input), make().prepare(context, input)]);
        expect(first.jobId).toBe(second.jobId);
        expect(await db.crmMigrationJob.count({ where: { workspaceId, id: first.jobId } })).toBe(1);
    });
    it("concurrent worker attempts do not duplicate a row, including a recoverable claim conflict", async () => {
        const p = await prepare("workers", 55);
        const results = await Promise.allSettled([application.executeNext(context, { jobId: p.jobId }), make().executeNext(context, { jobId: p.jobId })]);
        for (const result of results)
            if (result.status === "rejected") {
                // Documented optimistic claim conflicts may surface. Other exceptions are gate failures.
                expect(["P2034", "STALE_BATCH", "STALE_JOB", "TRANSACTION_RETRY_EXHAUSTED"]).toContain(result.reason?.code);
            }
        await finish(p.jobId);
        const report = await application.report(context, { jobId: p.jobId, afterRow: 0 });
        expect(report.created).toBe(55);
        expect(report.reconciliation.ok).toBe(true);
        const receipts = await db.crmMigrationRowReceipt.findMany({ where: { workspaceId, jobId: p.jobId } });
        expect(new Set(receipts.map(row => row.entityId)).size).toBe(55);
    });
    it("enforces tenant-composite source and row receipt constraints in the database", async () => {
        const p = await prepare("constraints");
        await expect(db.crmMigrationJob.update({ where: { id: p.jobId }, data: { workspaceId: `wrong-${suffix}` } })).rejects.toThrow();
        await finish(p.jobId);
        const row = await db.crmMigrationRowReceipt.findFirstOrThrow({ where: { workspaceId, jobId: p.jobId } });
        await expect(db.crmMigrationRowReceipt.create({ data: { ...row, id: `duplicate-${suffix}` } })).rejects.toThrow();
        await expect(db.$transaction(async (tx) => {
            const contactId = `rollback-proof-${suffix}`;
            await tx.contact.create({ data: { id: contactId, firstName: "Rollback proof", source: "IMPORT", ownerId: authorId } });
            await tx.crmMigrationRowReceipt.create({ data: { ...row, id: `conflicting-${suffix}` } });
        })).rejects.toThrow();
        expect(await db.contact.findUnique({ where: { id: `rollback-proof-${suffix}` } })).toBeNull();
    });
    it("cancellation prevents new writes and safe rollback preserves later edits", async () => {
        const p = await prepare("cancel");
        await application.cancel(context, { jobId: p.jobId });
        await expect(application.executeNext(context, { jobId: p.jobId })).rejects.toThrow();
        expect(await db.crmMigrationRowReceipt.count({ where: { workspaceId, jobId: p.jobId } })).toBe(0);
        const q = await prepare("archive");
        await finish(q.jobId);
        const receipts = await db.crmMigrationRowReceipt.findMany({ where: { workspaceId, jobId: q.jobId }, orderBy: { rowNumber: "asc" } });
        await db.contact.update({ where: { id: receipts[0]!.entityId! }, data: { title: "Edited after import", updatedAt: new Date(Date.now() + 1000) } });
        const result = await application.rollback(context, { jobId: q.jobId, afterRow: 0, apply: true, confirmation: q.jobId });
        expect(result.destructiveDelete).toBe(false);
        expect(result.rows.map(row => row.result)).toEqual(["RECORD_CHANGED", "ARCHIVED"]);
        expect((await db.contact.findUniqueOrThrow({ where: { id: receipts[0]!.entityId! } })).archivedAt).toBeNull();
    });
});
describe("Bound consent — actual PostgreSQL transaction and compare-and-swap", () => {
    const lifecycle = () => createPrismaApprovalLifecycle({ prisma: db, workspaceId });
    async function request(key: string) {
        const input = { recordId: `fixture-${suffix}`, subject: "A bounded operation" };
        const actionId = "crm.activity.create";
        // Independent canonical payload vector: keys at both levels are in sorted order.
        const digest = createHash("sha256").update(JSON.stringify({ actionId, input, manifestVersion: "1", tenantId: workspaceId })).digest("hex");
        return lifecycle().request({ context: { ...context, requestId: key, correlationId: `test-${key}` }, actionId, digest, manifestVersion: "1", risk: "MEDIUM", mutating: true, title: "Fixture approval", executionKey: key, input });
    }
    it("allows exactly one conflicting decision and exactly one consumption", async () => {
        const row = await request("consume-once");
        const decision = { approvalId: row.id, expectedVersion: row.version, expectedDigest: row.payloadDigest, reason: "Test decision" };
        await expect(lifecycle().decide(context, { ...decision, decision: "APPROVED" })).rejects.toThrow();
        const results = await Promise.allSettled([lifecycle().decide(admin, { ...decision, decision: "APPROVED" }), lifecycle().decide(admin, { ...decision, decision: "REJECTED" })]);
        expect(results.filter(row => row.status === "fulfilled").length).toBe(1);
        const final = await db.governedActionApproval.findUniqueOrThrow({ where: { id: row.id } });
        const approved = final.status === "APPROVED" ? row : await request("consume-approved");
        if (final.status !== "APPROVED")
            await lifecycle().decide(admin, { approvalId: approved.id, expectedVersion: approved.version, expectedDigest: approved.payloadDigest, decision: "APPROVED" });
        const command = { approvalId: approved.id, tenantId: workspaceId, actorId: authorId, actionId: approved.actionId, digest: approved.payloadDigest, executionKey: final.status === "APPROVED" ? "consume-once" : "consume-approved", now: new Date() };
        const consumed = await Promise.all([lifecycle().consume(command), lifecycle().consume(command)]);
        expect(consumed.filter(Boolean).length).toBe(1);
        expect((await db.governedActionApproval.findUniqueOrThrow({ where: { id: approved.id } })).status).toBe("CONSUMED");
    });
    it("audits deadline expiration and rejects a stale or wrong execution identity", async () => {
        const row = await request("expired");
        await db.governedActionApproval.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 120000), expiresAt: new Date(Date.now() - 60000) } });
        const decision = await lifecycle().decide(admin, { approvalId: row.id, expectedVersion: row.version, expectedDigest: row.payloadDigest, decision: "APPROVED" });
        expect(decision.status).toBe("EXPIRED");
        expect(await db.governedActionAuditEvent.count({ where: { workspaceId, eventType: "agent.approval.expired", payloadDigest: row.payloadDigest } })).toBeGreaterThan(0);
        expect(await lifecycle().consume({ approvalId: row.id, tenantId: workspaceId, actorId: approverId, actionId: row.actionId, digest: row.payloadDigest, executionKey: "expired", now: new Date() })).toBeNull();
    });
});

// The independent store instances share real PostgreSQL connections; no serializing fake repository.
describe("Native approval continuation — actual PostgreSQL acceptance (transport excluded)", () => {
    async function fixture(tag: string) {
        let millis = Date.now();
        const clock = () => new Date(millis);
        const runId = `continuation-${tag}-${suffix}`;
        const callId = `call-${tag}`;
        const sessionId = `child-${tag}-${suffix}`;
        await db.agentRun.create({ data: {
            id: runId, agentId: `continuation-agent-${suffix}`, versionId: `continuation-version-${suffix}`,
            initiatedById: authorId, triggerType: "MANUAL", status: "RUNNING", startedAt: clock(),
            sessionId: `root-${tag}-${suffix}`, idempotencyKey: runId, correlationId: runId,
        } });
        const lifecycle = createPrismaApprovalLifecycle({ prisma: db, workspaceId, clock });
        const input = { runId, callId, text: "No real message is sent by this DB test" };
        const digest = sha256Hex({ tenantId: workspaceId, actionId: "slack.message.post", manifestVersion: "1.0.0", input });
        const approval = await lifecycle.request({ context: { tenantId: workspaceId, actorId: `agent-run:${runId}`, requestId: runId, correlationId: runId },
            actionId: "slack.message.post", manifestVersion: "1.0.0", digest, executionKey: `${runId}:${callId}`, input, title: "Fixture", risk: "MEDIUM", mutating: true });
        const options = { prisma: db, workspaceId, clock, deliveryLeaseMs: 1000 };
        const store = createApprovalContinuationStore(options);
        const identity = { runId, sessionId, callId, approvalId: approval.id, payloadDigest: digest, toolName: "post_slack_message" };
        const ticket = await store.prepare(identity);
        await store.bind({ ...identity, requestId: `native-${tag}`, turnId: `turn-${tag}`, sequence: 1, eventId: `event-${tag}` });
        await store.park({ runId, sessionId, eventId: `waiting-${tag}` });
        await lifecycle.decide(admin, { approvalId: approval.id, expectedVersion: approval.version, expectedDigest: digest, decision: "APPROVED" });
        return { store, options, identity, ticket, advance: (ms: number) => { millis += ms; } };
    }
    it("competing independent dispatchers acquire a single exact-session claim", async () => {
        const f = await fixture("claim");
        const claims = await Promise.all([f.store.claim(f.ticket.id), createApprovalContinuationStore(f.options).claim(f.ticket.id)]);
        expect(claims.filter(Boolean).length).toBe(1);
        const claim = claims.find(Boolean)!;
        expect(claim.sessionId).toBe(f.identity.sessionId);
        expect(claim.rootSessionId).not.toBe(claim.sessionId);
        const run = await db.agentRun.findUniqueOrThrow({ where: { id: f.identity.runId } });
        expect(run.status).toBe("RUNNING");
        expect(run.approvalWaitStartedAt).toBeNull();
    });
    it("one-time transport admission and exact request binding survive new store instances", async () => {
        const f = await fixture("admit"); const claim = (await f.store.claim(f.ticket.id))!;
        expect(await f.store.admitDelivery({ ...claim, sessionId: "different-child" })).toBeNull();
        const results = await Promise.all([f.store.admitDelivery(claim), createApprovalContinuationStore(f.options).admitDelivery(claim)]);
        expect(results.filter(Boolean).length).toBe(1);
        expect(await db.governedActionAuditEvent.count({ where: { workspaceId, requestId: f.ticket.id, eventType: "agent.continuation.transport_admitted" } })).toBe(1);
    });
    it("expired dispatch leases are quarantined, not reacquired after process replacement", async () => {
        const f = await fixture("lease"); await f.store.claim(f.ticket.id); f.advance(1001);
        const restarted = createApprovalContinuationStore(f.options); await restarted.candidates();
        expect((await db.governedActionContinuation.findUniqueOrThrow({ where: { id: f.ticket.id, workspaceId } })).status).toBe("RECONCILIATION_REQUIRED");
        expect(await restarted.claim(f.ticket.id)).toBeNull();
    });
    it("database uniqueness and workspace FK fence repeated/native cross-tenant requests", async () => {
        const f = await fixture("constraints");
        const row = await db.governedActionContinuation.findUniqueOrThrow({ where: { id: f.ticket.id, workspaceId } });
        await expect(db.governedActionContinuation.create({ data: { ...row, id: `duplicate-cont-${suffix}` } })).rejects.toThrow();
        await expect(db.governedActionContinuation.update({ where: { id: row.id }, data: { workspaceId: `other-${suffix}` } })).rejects.toThrow();
        await expect(createApprovalContinuationStore({ ...f.options, workspaceId: `other-${suffix}` }).claim(row.id)).rejects.toThrow();
    });
    it("native request replacement commits quarantine and blocks subsequent delivery", async () => {
        const f = await fixture("native-conflict");
        await expect(f.store.bind({ ...f.identity, requestId: "replacement", turnId: "other-turn", sequence: 2, eventId: "other-event" })).rejects.toThrow();
        expect((await db.governedActionContinuation.findUniqueOrThrow({ where: { id: f.ticket.id, workspaceId } })).status).toBe("RECONCILIATION_REQUIRED");
        expect(await f.store.claim(f.ticket.id)).toBeNull();
    });
});

// New real-PostgreSQL acceptance; NOT part of dependency-free test counts.
describe("source lifecycle and background worker acceptance", () => {
  it("serializes source deletion against publishing a prepared job", async () => {
    const u=await application.upload(context,{filename:"race.csv",mimeType:"text/csv",base64:Buffer.from(`Name,Email\nRace,race-${suffix}@example.test\n`).toString("base64")});
    const results=await Promise.allSettled([
      application.prepare(context,{sourceId:u.source.id,expectedSha256:u.source.sha256,entityType:"contact",mapping,commandId:"lifecycle-race"}),
      application.removeSource(admin,{sourceId:u.source.id,expectedSha256:u.source.sha256}),
    ]);
    expect(results.filter(x=>x.status==="fulfilled").length).toBe(1);
    const row=await db.crmMigrationSource.findFirstOrThrow({where:{id:u.source.id,workspaceId}});
    const references=await db.crmMigrationJob.count({where:{workspaceId,sourceId:u.source.id}});
    expect(row.deletedAt!==null && references>0).toBe(false);
  });
  it("persists one audit completion for concurrent physical removal", async () => {
    const u=await application.upload(context,{filename:"remove.csv",mimeType:"text/csv",base64:Buffer.from("Name,Email\nA,a@example.test\n").toString("base64")});
    const input={sourceId:u.source.id,expectedSha256:u.source.sha256};
    await Promise.all([application.removeSource(context,input),make().removeSource(admin,input)]);
    expect(await db.crmMigrationSourceEvent.count({where:{workspaceId,sourceId:u.source.id,type:"source.purge.completed"}})).toBe(1);
    expect((await db.crmMigrationSource.findFirstOrThrow({where:{workspaceId,id:u.source.id}})).purgedAt).not.toBeNull();
  });
  it("two worker connections honor one queue claim and exact row receipts", async () => {
    const p=await prepare("worker-concurrency",52);let now=new Date();
    const bg=()=>createMigrationApplication({db,workspaceId,sourceStore:store,enabled:true,executeEnabled:true,backgroundEnabled:true,clock:()=>new Date(now)});
    await bg().setBackground(context,{jobId:p.jobId,enabled:true,confirmation:p.jobId});
    for(let i=0;i<4;i++){await Promise.all([bg().runBackgroundOnce(),bg().runBackgroundOnce()]);now=new Date(now.getTime()+10000);}
    const report=await application.report(context,{jobId:p.jobId});expect(report.created).toBe(52);expect(report.reconciliation.ok).toBe(true);
    expect(await db.crmMigrationRowReceipt.count({where:{workspaceId,jobId:p.jobId}})).toBe(52);
  });
  it("keeps every referenced source even after all rows are complete",async()=>{
    const p=await prepare("retention-complete");await finish(p.jobId);
    const future=createMigrationApplication({db,workspaceId,sourceStore:store,enabled:true,executeEnabled:true,clock:()=>new Date(Date.now()+100*86400000)});
    const preview=await future.cleanupSources(context);expect(preview.candidates.some(x=>x.sourceId===p.uploaded.source.id)).toBe(false);
    await expect(future.removeSource(context,{sourceId:p.uploaded.source.id,expectedSha256:p.uploaded.source.sha256})).rejects.toMatchObject({code:"SOURCE_IN_USE"});
  });
});
