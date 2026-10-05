import test from "node:test";
import assert from "node:assert/strict";
import { createAgentOperations, summarizeRunWindow, publicOperationsError, governedReceiptDigest } from "../src/operations/operations-core.mjs";
import { migrationPrismaDouble } from "./helpers/migration-prisma-double.mjs";
const at = new Date("2026-09-14T10:00:00Z"), yesterday = new Date("2026-09-13T12:00:00Z");
const ctx = { tenantId: "ws", actorId: "admin" };
function setup(extra = {}) {
    const f = migrationPrismaDouble({ member: [{ organizationId: "ws", userId: "admin", role: "admin" }, { organizationId: "ws", userId: "viewer", role: "member" }], agentDefinition: [{ id: "team", name: "Team", status: "LIVE", deletedAt: null, updatedAt: at }, { id: "private", name: "Private", status: "DRAFT", createdById: "another", updatedAt: at }], agentRun: [{ id: "r1", agentId: "team", versionId: "v1", status: "SUCCEEDED", costUsd: "0.100001", createdAt: yesterday }, { id: "r2", agentId: "team", versionId: "v1", status: "FAILED", costUsd: null, createdAt: at, errorCode: "ETIMEDOUT" }, { id: "secret", agentId: "private", versionId: "v2", status: "FAILED", costUsd: "9999", createdAt: at }], agentAction: [{ id: "act", agentId: "team", runId: "r1", type: "crm.activity.create", provider: "crm", status: "FAILED", requestHash: "c".repeat(64), metadata: { operationDigest: "a".repeat(64) }, plannedAt: yesterday, attemptCount: 1 }], governedActionReceipt: [{ id: "rec", workspaceId: "ws", actionId: "crm.activity.create", payloadDigest: "a".repeat(64), status: "AMBIGUOUS", errorCode: "UNKNOWN_OUTCOME" }, { id: "hidden", workspaceId: "ws", actionId: "crm.activity.create", payloadDigest: "b".repeat(64), status: "AMBIGUOUS" }, { id: "cross", workspaceId: "other", actionId: "crm.activity.create", payloadDigest: "a".repeat(64), status: "AMBIGUOUS" }], ...extra });
    return { ...f, app: createAgentOperations({ prisma: f.db, workspaceId: "ws", clock: () => at, approvalsEnabled: false }) };
}
test("overview is current-admin only and dedicated-workspace bound", async () => { const f = setup(); await assert.rejects(f.app.overview({ tenantId: "other", actorId: "admin" }), e => e.code === "OPERATIONS_FORBIDDEN"); await assert.rejects(f.app.overview({ tenantId: "ws", actorId: "viewer" }), e => e.code === "OPERATIONS_FORBIDDEN"); f.state.member = []; await assert.rejects(f.app.overview(ctx), e => e.code === "OPERATIONS_FORBIDDEN"); });
test("private drafts and unrelated receipts do not leak into team overview", async () => { const f = setup(); const result = await f.app.overview(ctx); assert.equal(result.metrics.runCount, 2); assert.equal(result.metrics.activeAgents, 1); assert.equal(result.metrics.incidentCount, 1); assert.equal(result.incidents[0].type, "AMBIGUOUS_OUTCOME"); assert.equal(JSON.stringify(result).includes("Private"), false); assert.equal(JSON.stringify(result).includes("hidden"), false); assert.equal(JSON.stringify(result).includes("cross"), false); });
test("costs use exact micro-USD and report missing records separately", () => { const x = summarizeRunWindow([{ status: "SUCCEEDED", costUsd: "0.100001" }, { status: "FAILED", costUsd: "0.200002" }, { status: "WAITING_FOR_APPROVAL", costUsd: null }], 3); assert.equal(x.recordedAiCostUsd, "0.300003"); assert.equal(x.runsWithoutRecordedCost, 1); assert.equal(x.successRatePercent, 50); assert.equal(x.outcomeValue, null); assert.equal(x.validatedTimeSaved, null); });
test("missing, negative, invalid costs and zero-completion rates are not invented", () => { const x = summarizeRunWindow([{ status: "RUNNING", costUsd: null }, { status: "QUEUED", costUsd: "-1" }, { status: "WAITING_FOR_APPROVAL", costUsd: "NaN" }], 3); assert.equal(x.recordedAiCostUsd, null); assert.equal(x.successRatePercent, null); assert.equal(x.runsWithoutRecordedCost, 3); });
test("a truncated window cannot masquerade as a full success rate or cost total", () => { const x = summarizeRunWindow([{ status: "SUCCEEDED", costUsd: "0.001" }], 5001); assert.equal(x.complete, false); assert.equal(x.runCount, 5001); assert.equal(x.counts, null); assert.equal(x.recordedAiCostUsd, null); assert.equal(x.successRatePercent, null); });
test("read period has explicit rolling UTC bounds and rejects arbitrary large windows", async () => { const f = setup(); const result = await f.app.overview(ctx, { hours: 24 }); assert.equal(result.window.from, "2026-09-13T10:00:00.000Z"); assert.equal(result.window.to, at.toISOString()); await assert.rejects(f.app.overview(ctx, { hours: 100000 }), e => e.code === "OPERATIONS_INPUT_INVALID"); });
test("operations never turns lack of provider/outcome instrumentation into positive health", async () => { const f = setup(); const result = await f.app.overview(ctx); assert.equal(result.health.liveProvidersVerified, false); assert.equal(result.health.outcomeLedgerImplemented, false); assert.equal(result.metrics.pendingApprovals, null); assert.equal(result.incidents[0].safeToAutomaticallyRetry, false); });
test("unsafe database errors and prompt-like error messages are not returned to operators", async () => { const f = setup(); f.state.agentRun[0].errorCode = "password=secret"; const result = await f.app.overview(ctx); assert.equal(result.runs.find(x => x.id === "r1").errorCode, null); assert.equal(JSON.stringify(publicOperationsError(new Error("postgres://secret"))).includes("secret"), false); });
test("disabled approval lifecycle performs no mutation even for administrators", async () => { const f = setup(); await assert.rejects(f.app.approvals(ctx, {}), e => e.code === "OPERATIONS_NOT_CONFIGURED"); await assert.rejects(f.app.decide(ctx, {}), e => e.code === "OPERATIONS_NOT_CONFIGURED"); assert.equal(f.state.governedActionAuditEvent.length, 0); });
test("empty team yields a true empty state, no seeded demo metrics", async () => { const f = setup({ agentDefinition: [], agentRun: [], agentAction: [] }); const result = await f.app.overview(ctx); assert.equal(result.metrics.runCount, 0); assert.equal(result.runs.length, 0); assert.equal(result.actions.length, 0); assert.equal(result.metrics.recordedAiCostUsd, null); });
test("receipt correlation uses governed metadata, never the unrelated CRM requestHash", async () => {
    const f = setup();
    const a = f.state.agentAction[0];
    assert.notEqual(a.requestHash, a.metadata.operationDigest);
    assert.equal((await f.app.overview(ctx)).incidents[0].type, "AMBIGUOUS_OUTCOME");
    delete a.metadata;
    a.requestHash = "a".repeat(64);
    const result = await f.app.overview(ctx);
    assert.equal(result.incidents[0].type, "ACTION_FAILED");
    assert.equal(result.metrics.incidentCount, null);
    assert.equal(result.health.receiptCorrelationComplete, false);
    assert.equal(result.health.actionsWithoutReceiptLink, 1);
});
test("a different action kind cannot borrow the digest correlation", async () => {
    const f = setup();
    f.state.governedActionReceipt[0].actionId = "slack.message.post";
    assert.equal((await f.app.overview(ctx)).incidents[0].type, "ACTION_FAILED");
});
test("metadata lookup refuses accessors and inherited correlation", () => {
    const metadata = Object.create({ operationDigest: "a".repeat(64) });
    assert.equal(governedReceiptDigest({ metadata }), null);
    Object.defineProperty(metadata, "operationDigest", { get() { throw new Error("must not execute"); } });
    assert.equal(governedReceiptDigest({ metadata }), null);
});

test("continuation view is current-admin only, opt-in and exposes no lease/JWT/raw payload",async()=>{
 const f=setup();const disabled=f.app;
 await assert.rejects(disabled.continuations(ctx,{}),e=>e.code==="OPERATIONS_NOT_CONFIGURED");
 assert.equal(f.calls.some(x=>x.model==="governedActionContinuation"),false);
 const app=createAgentOperations({prisma:f.db,workspaceId:"ws",clock:()=>at,continuationsEnabled:true});
 f.state.governedActionContinuation.push({id:"gc-1",workspaceId:"ws",approvalId:"a-1",runId:"r1",callId:"call-1",toolName:"post_slack_message",status:"RECONCILIATION_REQUIRED",decision:"approve",errorCode:"DELIVERY_OUTCOME_UNKNOWN",leaseToken:"do-not-return",payloadDigest:"a".repeat(64),sessionId:"private-session",createdAt:at,updatedAt:at});
 f.state.governedActionContinuation.push({...f.state.governedActionContinuation[0],id:"other-tenant",workspaceId:"other"});
 const view=await app.continuations(ctx,{status:"ATTENTION"});assert.equal(view.items.length,1);assert.equal(view.items[0].safeToAutomaticallyRetry,false);
 assert.equal(JSON.stringify(view).includes("do-not-return"),false);assert.equal(JSON.stringify(view).includes("private-session"),false);
 await assert.rejects(app.continuations({tenantId:"ws",actorId:"viewer"},{}),e=>e.code==="OPERATIONS_FORBIDDEN");
 f.state.member=[];await assert.rejects(app.continuations(ctx,{}),e=>e.code==="OPERATIONS_FORBIDDEN");
});
test("continuation pagination has stable tie-breaks and does not silently drop same-time rows",async()=>{
 const f=setup();const app=createAgentOperations({prisma:f.db,workspaceId:"ws",clock:()=>at,continuationsEnabled:true});
 for(let i=0;i<55;i++)f.state.governedActionContinuation.push({id:`gc-${String(i).padStart(3,"0")}`,workspaceId:"ws",approvalId:`a-${i}`,runId:"r1",callId:`call-${i}`,toolName:"post_slack_message",status:"READY",decision:null,createdAt:at,updatedAt:at});
 const a=await app.continuations(ctx,{}),b=await app.continuations(ctx,{before:a.next});
 assert.equal(a.items.length,50);assert.equal(b.items.length,5);assert.equal(new Set([...a.items,...b.items].map(x=>x.id)).size,55);
 await assert.rejects(app.continuations(ctx,{status:"INVALID"}));await assert.rejects(app.continuations(ctx,{before:{id:"x",createdAt:"nope"}}));
});
