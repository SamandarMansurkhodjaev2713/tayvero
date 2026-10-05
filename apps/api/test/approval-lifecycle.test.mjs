import test from "node:test";
import assert from "node:assert/strict";
import { createPrismaApprovalLifecycle, createGovernedActionExecutor, createMemoryReceiptStore, sha256Hex } from "@crm/agent-action-runtime";
import { migrationPrismaDouble } from "./helpers/migration-prisma-double.mjs";
const ctx = { tenantId: "ws", actorId: "author", requestId: "req-1", correlationId: "corr-1", permissions: ["crm.deal.update"] };
const admin = { tenantId: "ws", actorId: "approver" };
const payload = { dealId: "d1", amount: 10 };
function setup() {
    const f = migrationPrismaDouble({ member: [{ organizationId: "ws", userId: "author", role: "admin" }, { organizationId: "ws", userId: "approver", role: "owner" }, { organizationId: "ws", userId: "viewer", role: "member" }], agentRun: [{ id: "run-1", versionId: "v-1", initiatedById: "author", status: "RUNNING", cancelRequestedAt: null }], agentVersion: [{ id: "v-1", createdById: "author", agentId: "a-1" }], agentDefinition: [{ id: "a-1", status: "LIVE" }] });
    let now = new Date("2026-09-14T10:00:00Z");
    const clock = () => new Date(now);
    const make = () => createPrismaApprovalLifecycle({ prisma: f.db, workspaceId: "ws", clock, ttlMs: 60000 });
    const store = make();
    const req = extra => { const q = { context: ctx, actionId: "crm.deal.update", manifestVersion: "1", risk: "HIGH", mutating: true, title: "Update one deal", executionKey: "op-1", input: payload, ...extra }; q.digest ??= sha256Hex({ tenantId: q.context.tenantId, actionId: q.actionId, manifestVersion: q.manifestVersion, input: q.input }); return q; };
    const request = extra => store.request(req(extra));
    const decide = (p, decision = "APPROVED", c = admin, extra = {}) => store.decide(c, { approvalId: p.id, expectedVersion: p.version, expectedDigest: p.payloadDigest, decision, ...extra });
    const consume = (p, extra = {}) => store.consume({ approvalId: p.id, tenantId: "ws", actorId: "author", actionId: "crm.deal.update", digest: p.payloadDigest, executionKey: "op-1", now: clock(), ...extra });
    return { ...f, store, make, clock, setNow: v => now = new Date(v), req, request, decide, consume };
}
const code = (p, c) => assert.rejects(p, e => e.code === c);
test("request is immutable, requester-bound and idempotent across service instances", async () => { const f = setup(); const a = await f.request(); const b = await f.make().request(f.req()); assert.equal(a.id, b.id); assert.equal(f.state.governedActionApproval.length, 1); assert.equal(f.state.governedActionAuditEvent.length, 1); assert.equal(a.snapshot.previewComplete, true); await code(f.request({ input: { ...payload, amount: 20 } }), "APPROVAL_KEY_REUSED"); });
test("no forged tenant or digest is accepted", async () => { const f = setup(); await code(f.request({ context: { ...ctx, tenantId: "other" } }), "APPROVAL_FORBIDDEN"); await code(f.request({ digest: "0".repeat(64) }), "APPROVAL_DIGEST_MISMATCH"); assert.equal(f.state.governedActionApproval.length, 0); });
test("queue and decisions require current administrator membership", async () => { const f = setup(); const a = await f.request(); await code(f.store.list({ tenantId: "ws", actorId: "viewer" }), "APPROVAL_FORBIDDEN"); await code(f.decide(a, "APPROVED", { tenantId: "ws", actorId: "viewer" }), "APPROVAL_FORBIDDEN"); await code(f.store.list({ tenantId: "other", actorId: "approver" }), "APPROVAL_FORBIDDEN"); });
test("self approval is prohibited for both direct human and agent-run requesters", async () => { const f = setup(); const a = await f.request(); await code(f.decide(a, "APPROVED", ctx), "APPROVAL_SELF_DECISION"); const b = await f.request({ context: { ...ctx, actorId: "agent-run:run-1" }, input: { ...payload, runId: "run-1", callId: "call-1" } }); assert.equal(b.requesterUserId, "author"); await code(f.decide(b, "APPROVED", ctx), "APPROVAL_SELF_DECISION"); });
test("agent run linkage is loaded server-side and inactive runs fail closed", async () => { const f = setup(); await code(f.request({ context: { ...ctx, actorId: "agent-run:run-1" }, input: { runId: "other", amount: 3 } }), "APPROVAL_FORBIDDEN"); f.state.agentRun[0].status = "FAILED"; await code(f.request({ context: { ...ctx, actorId: "agent-run:run-1" }, input: { runId: "run-1", amount: 3 } }), "APPROVAL_RUN_INACTIVE"); });
test("approval and audit are atomic; audit failure cannot leave consent behind", async () => { const f = setup(); const a = await f.request(); f.setHook((m, o) => { if (m === "governedActionAuditEvent" && o === "create")
    throw new Error("audit offline"); }); await assert.rejects(f.decide(a)); assert.equal(f.state.governedActionApproval[0].status, "PENDING"); });
test("repeated same decision is idempotent but stale opposite decisions are blocked", async () => { const f = setup(); const a = await f.request(); const b = await f.decide(a); await f.decide(a); assert.equal(f.state.governedActionAuditEvent.length, 2); await code(f.decide(a, "CANCELLED"), "APPROVAL_STALE"); assert.equal(b.version, 1); });
test("expiry is committed and audited instead of rolled back with an exception", async () => { const f = setup(); const a = await f.request(); f.setNow("2026-09-14T10:01:00Z"); const b = await f.decide(a); assert.equal(b.status, "EXPIRED"); assert.equal(f.state.governedActionApproval[0].status, "EXPIRED"); assert.equal(f.state.governedActionAuditEvent.at(-1).eventType, "agent.approval.expired"); });
test("cannot explicitly expire before deadline", async () => { const f = setup(); const a = await f.request(); await code(f.decide(a, "EXPIRED"), "APPROVAL_NOT_EXPIRED"); });
test("cannot approve redacted or truncated content without a complete safe preview", async () => { const f = setup(); const a = await f.request({ input: { ...payload, apiKey: "not-to-be-stored" } }); assert.equal(a.snapshot.previewComplete, false); assert.equal(JSON.stringify(f.state.governedActionApproval).includes("not-to-be-stored"), false); await code(f.decide(a), "APPROVAL_PREVIEW_INCOMPLETE"); const b = await f.request({ executionKey: "long", input: { text: "x".repeat(2500) } }); await code(f.decide(b), "APPROVAL_PREVIEW_INCOMPLETE"); });
test("approved consent is one-shot and bound to execution key, digest and actor", async () => { const f = setup(); const a = await f.request(); await f.decide(a); assert.equal(await f.consume(a, { actorId: "approver" }), null); assert.equal(await f.consume(a, { executionKey: "another" }), null); assert.equal(await f.consume(a, { digest: "0".repeat(64) }), null); assert.equal((await f.consume(a)).consumed, true); assert.equal(await f.consume(a), null); assert.equal(f.state.governedActionAuditEvent.at(-1).eventType, "agent.approval.consumed"); });
test("revoked approving administrator invalidates unused consent", async () => { const f = setup(); const a = await f.request(); await f.decide(a); f.state.member = f.state.member.filter(x => x.userId !== "approver"); await code(f.consume(a), "APPROVAL_FORBIDDEN"); assert.equal(f.state.governedActionApproval[0].status, "APPROVED"); });
test("consumption audit failure leaves consent unconsumed and executes nothing", async () => { const f = setup(); const a = await f.request(); await f.decide(a); f.setHook((m, o) => { if (m === "governedActionAuditEvent" && o === "create")
    throw new Error("offline"); }); await assert.rejects(f.consume(a)); assert.equal(f.state.governedActionApproval[0].status, "APPROVED"); });
test("cancel and reject are terminal and do not start execution", async () => { const f = setup(); const a = await f.request(); const b = await f.decide(a); const c = await f.decide(b, "CANCELLED"); assert.equal(c.startsExecution, false); assert.equal(await f.consume(a), null); await code(f.decide(c), "APPROVAL_TERMINAL"); const d = await f.request({ executionKey: "reject" }); await f.decide(d, "REJECTED"); assert.equal(await f.consume(d, { executionKey: "reject" }), null); });
test("legacy unbound approvals are visible but cannot be newly approved or consumed", async () => { const f = setup(); f.state.governedActionApproval.push({ id: "legacy", workspaceId: "ws", actionId: "crm.deal.update", payloadDigest: "0".repeat(64), status: "PENDING", requestedById: "author", version: 0, createdAt: f.clock(), expiresAt: new Date(f.clock().getTime() + 60000) }); const a = (await f.store.list(admin)).items[0]; assert.equal(a.legacyUnbound, true); assert.equal(a.canApprove, false); await code(f.decide(a), "APPROVAL_UNBOUND"); });
test("two decision callers cannot both create conflicting final states", async () => { const f = setup(); const a = await f.request(); const results = await Promise.allSettled([f.decide(a), f.decide(a, "REJECTED")]); assert.equal(results.filter(x => x.status === "fulfilled").length, 1); assert.equal(f.state.governedActionAuditEvent.length, 2); });
test("two consumers cannot both obtain one approval (query-contract double, not database proof)", async () => { const f = setup(); const a = await f.request(); await f.decide(a); const results = await Promise.all([f.consume(a), f.consume(a)]); assert.equal(results.filter(Boolean).length, 1); });
test("list cursor keeps distinct requests with identical timestamps", async () => { const f = setup(); for (let i = 0; i < 55; i++) {
    const a = await f.request({ executionKey: `op-${i}` });
    if (i < 6)
        await f.decide(a, "REJECTED");
} const a = await f.store.list(admin); const b = await f.store.list(admin, { before: a.next }); assert.equal(a.items.length, 50); assert.equal(b.items.length, 5); assert.equal(new Set([...a.items, ...b.items].map(x => x.id)).size, 55); });
test("pending expiry filters reflect deadlines even without a scheduled sweeper", async () => { const f = setup(); await f.request(); f.setNow("2026-09-14T10:02:00Z"); assert.equal((await f.store.list(admin, { status: "PENDING" })).items.length, 0); assert.equal((await f.store.list(admin, { status: "EXPIRED" })).items.length, 1); });
test("governed executor requests consent, rechecks authorization, consumes once and replays receipt", async () => {
    const f = setup();
    let calls = 0, allowed = true;
    const manifest = { id: "crm.deal.update", title: "Update deal", version: "1", risk: "HIGH", mutating: true, idempotency: "KEYED", permissions: ["crm.deal.update"], inputValidator: x => x, outputValidator: x => x, timeoutMs: 1000 };
    const executor = createGovernedActionExecutor({ registry: new Map([[manifest.id, { manifest, execute: async () => { calls++; return { ok: true }; } }]]), authorizer: async () => allowed, policyEvaluator: async () => ({ allowed: true, requiresApproval: true }), approvalStore: f.store, receiptStore: createMemoryReceiptStore(), auditSink: { append: async () => { } }, clock: f.clock });
    const request = { actionId: manifest.id, input: payload, context: ctx, idempotencyKey: "op-1" };
    let pending;
    await assert.rejects(executor.execute(request), e => { pending = e.safeDetails?.approvalId; return e.code === "APPROVAL_REQUIRED"; });
    assert.equal(calls, 0);
    assert.ok(pending);
    const a = (await f.store.list(admin)).items[0];
    await f.decide(a);
    allowed = false;
    await code(executor.execute(request), "ACTION_FORBIDDEN");
    assert.equal(f.state.governedActionApproval[0].status, "APPROVED");
    allowed = true;
    assert.deepEqual(await executor.execute(request), { ok: true });
    assert.deepEqual(await executor.execute(request), { ok: true });
    assert.equal(calls, 1);
    assert.equal(f.state.governedActionApproval[0].status, "CONSUMED");
});
test("denied actions never allocate approval requests", async () => { const f = setup(); const manifest = { id: "crm.deal.update", version: "1", risk: "HIGH", mutating: true, idempotency: "KEYED", permissions: ["crm.deal.update"], inputValidator: x => x, outputValidator: x => x }; const ex = createGovernedActionExecutor({ registry: new Map([[manifest.id, { manifest, execute: async () => ({}) }]]), authorizer: async () => true, policyEvaluator: async () => ({ allowed: false }), approvalStore: f.store, receiptStore: createMemoryReceiptStore(), auditSink: { append: async () => { } }, clock: f.clock }); await code(ex.execute({ actionId: manifest.id, input: payload, context: ctx, idempotencyKey: "x" }), "ACTION_POLICY_DENIED"); assert.equal(f.state.governedActionApproval.length, 0); });
test("expiry uses the current service clock, never a caller-provided backdated timestamp", async () => {
    const f = setup();
    const a = await f.request();
    await f.decide(a);
    f.setNow("2026-09-14T10:02:00Z");
    assert.equal(await f.consume(a, { now: new Date("2026-09-14T10:00:01Z") }), null);
    assert.equal(f.state.governedActionApproval[0].status, "APPROVED");
});
test("approval cannot be consumed if authority queries cross its deadline", async () => {
    const f = setup();
    const a = await f.request();
    await f.decide(a);
    f.setHook((model, operation) => { if (model === "member" && operation === "findUnique")
        f.setNow("2026-09-14T10:02:00Z"); });
    assert.equal(await f.consume(a), null);
    assert.equal(f.state.governedActionApproval[0].status, "APPROVED");
});
test("decision crossing the deadline becomes an audited expiration instead of late consent", async () => {
    const f = setup();
    const a = await f.request();
    let reads = 0;
    f.setHook((model, operation) => { if (model === "member" && operation === "findUnique" && ++reads === 2)
        f.setNow("2026-09-14T10:02:00Z"); });
    assert.equal((await f.decide(a)).status, "EXPIRED");
    assert.equal(f.state.governedActionAuditEvent.at(-1).eventType, "agent.approval.expired");
});
