import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEncryptedFileSourceStore } from "@crm/migration-runtime";
import { createMigrationApplication } from "../src/migrations/migration-application.mjs";
import { migrationPrismaDouble } from "./helpers/migration-prisma-double.mjs";
const context = { tenantId: "workspace-a", actorId: "admin-a" };
const mapping = [{ source: "Name", target: "firstName" }, { source: "Email", target: "email" }];
async function setup(t, options = {}) {
    const root = await mkdtemp(path.join(tmpdir(), "tayvero-app-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const fake = migrationPrismaDouble({ member: [{ organizationId: "workspace-a", userId: "admin-a", role: "admin" }, { organizationId: "workspace-a", userId: "owner-a", role: "owner" }] });
    let now = new Date("2026-09-14T10:00:00Z");
    const clock = () => new Date(now);
    const store = await createEncryptedFileSourceStore({ root, keys: { v1: new Uint8Array(32).fill(7) }, activeKeyId: "v1", clock });
    const make = extra => createMigrationApplication({ db: fake.db, sourceStore: store, workspaceId: context.tenantId, clock, enabled: true, executeEnabled: true, ...options, ...extra });
    const app = make();
    async function upload(text = "Name,Email\nAlice,ALICE@example.test\nBob,bob@example.test\n") { return app.upload(context, { filename: "contacts.csv", mimeType: "text/csv", base64: Buffer.from(text).toString("base64") }); }
    async function prepare(text, extra = {}) { const u = await upload(text); const p = await app.prepare(context, { sourceId: u.source.id, expectedSha256: u.source.sha256, entityType: "contact", mapping, commandId: "cmd-1", ...extra }); return { ...p, upload: u }; }
    async function finish(jobId) { let last; for (let i = 0; i < 120; i++) {
        last = await app.executeNext(context, { jobId });
        if (last.done)
            return last;
    } throw new Error("execution did not terminate"); }
    return { ...fake, app, store, root, make, upload, prepare, finish, setNow: value => { now = new Date(value); } };
}
const rejectsCode = (promise, code) => assert.rejects(promise, e => e.code === code);
test("privileged operations derive dedicated workspace and recheck current membership", async (t) => { const f = await setup(t); await rejectsCode(f.app.list({ ...context, tenantId: "workspace-b" }), "FORBIDDEN"); f.state.member[0].role = "member"; await rejectsCode(f.upload(), "FORBIDDEN"); assert.equal(f.state.crmMigrationSource.length, 0); });
test("disabled execution is a real server gate, not a disabled UI button", async (t) => { const f = await setup(t, { executeEnabled: false }); const p = await f.prepare(); await rejectsCode(f.app.executeNext(context, { jobId: p.jobId }), "EXECUTION_DISABLED"); assert.equal(f.state.contact.length, 0); assert.equal((await f.app.capabilities(context)).executionEnabled, false); });
test("upload persists encrypted bytes and preview survives application recreation", async (t) => { const f = await setup(t); const u = await f.upload(); const other = f.make(); const p = await other.preview(context, { sourceId: u.source.id, expectedSha256: u.source.sha256 }); assert.equal(p.preview.totalRows, 2); assert.equal(f.state.crmMigrationSource.length, 1); const dir = (await readdir(f.root))[0]; const file = (await readdir(path.join(f.root, dir)))[0]; assert.equal((await readFile(path.join(f.root, dir, file))).includes(Buffer.from("alice@example.test")), false); });
test("invalid encoding, canonical base64, large files and XLSX fail before publication", async (t) => { const f = await setup(t); await rejectsCode(f.app.upload(context, { filename: "a.csv", mimeType: "text/csv", base64: "YQ==\n" }), "INVALID_UPLOAD"); await rejectsCode(f.app.upload(context, { filename: "a.csv", mimeType: "text/csv", base64: Buffer.alloc(600000).toString("base64") }), "INVALID_UPLOAD"); await assert.rejects(f.app.upload(context, { filename: "a.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: Buffer.from("PK\x03\x04bad").toString("base64") })); assert.equal(f.state.crmMigrationSource.length, 0); });
test("source fingerprints and cross-workspace source lookups fail closed", async (t) => { const f = await setup(t); const u = await f.upload(); await rejectsCode(f.app.preview(context, { sourceId: u.source.id, expectedSha256: "f".repeat(64) }), "SOURCE_CHANGED"); f.state.crmMigrationSource[0].workspaceId = "workspace-b"; await rejectsCode(f.app.preview(context, { sourceId: u.source.id, expectedSha256: u.source.sha256 }), "NOT_FOUND"); });
test("mapping cannot assign owner/tenant fields; unsupported deal writes fail", async (t) => { const f = await setup(t); const u = await f.upload(); const args = { sourceId: u.source.id, expectedSha256: u.source.sha256, entityType: "contact", commandId: "cmd-1" }; await assert.rejects(f.app.prepare(context, { ...args, mapping: [{ source: "Name", target: "firstName" }, { source: "Email", target: "ownerId" }] })); await rejectsCode(f.app.prepare(context, { ...args, mapping, entityType: "deal" }), "UNSUPPORTED_ENTITY"); assert.equal(f.state.crmMigrationJob.length, 0); });
test("prepare is atomic, idempotent and immutable for the same command", async (t) => { const f = await setup(t); const p = await f.prepare(); const args = { sourceId: p.upload.source.id, expectedSha256: p.upload.source.sha256, entityType: "contact", mapping, commandId: "cmd-1" }; await f.app.prepare(context, args); assert.equal(f.state.crmMigrationJob.length, 1); assert.equal(f.state.crmMigrationBatch.length, 1); assert.equal(f.state.contact.length, 0); await rejectsCode(f.app.prepare(context, { ...args, mapping: [{ source: "Name", target: "firstName" }, { source: "Email", target: "phone" }] }), "COMMAND_REUSED"); });
test("preparation failure rolls back job, plan and issues together", async (t) => { const f = await setup(t); f.setHook((m, o) => { if (m === "crmMigrationIssue" && o === "create")
    throw new Error("disk unavailable"); }); await assert.rejects(f.prepare("Name,Email\n,invalid\n")); assert.equal(f.state.crmMigrationJob.length, 0); assert.equal(f.state.crmMigrationBatch.length, 0); });
test("every valid row gets a receipt in the transaction creating the CRM record", async (t) => { const f = await setup(t); const p = await f.prepare(); assert.equal((await f.finish(p.jobId)).status, "COMPLETED"); const report = await f.app.report(context, { jobId: p.jobId }); assert.equal(f.state.contact.length, 2); assert.equal(f.state.contact[0].email, "alice@example.test"); assert.equal(f.state.contact[0].ownerId, context.actorId); assert.equal(report.created, 2); assert.equal(report.reconciliation.ok, true); assert.equal(report.remaining, 0); });
test("repeat execution and repeat import never merge or overwrite exact contacts", async (t) => { const f = await setup(t); const p = await f.prepare(); await f.finish(p.jobId); await f.app.executeNext(context, { jobId: p.jobId }); const q = await f.app.prepare(context, { sourceId: p.upload.source.id, expectedSha256: p.upload.source.sha256, entityType: "contact", mapping, commandId: "cmd-2" }); await f.finish(q.jobId); const report = await f.app.report(context, { jobId: q.jobId }); assert.equal(f.state.contact.length, 2); assert.equal(report.created, 0); assert.equal(report.duplicates, 2); assert.equal(report.reconciliation.ok, true); });
test("database receipt failure rolls back customer writes before any retry", async (t) => { const f = await setup(t); const p = await f.prepare(); f.setHook((m, o) => { if (m === "crmMigrationRowReceipt" && o === "create")
    throw new Error("receipt failure"); }); await assert.rejects(f.app.executeNext(context, { jobId: p.jobId })); assert.equal(f.state.contact.length, 0); assert.equal(f.state.crmMigrationRowReceipt.length, 0); f.setHook(null); await f.finish(p.jobId); assert.equal(f.state.contact.length, 2); });
test("crash after CRM commit but before batch settlement replays receipts, not writes", async (t) => { const f = await setup(t); const p = await f.prepare(); let blocked = true; f.setHook((m, o, args) => { if (blocked && m === "crmMigrationBatch" && o === "updateMany" && args.data.status === "COMPLETED") {
    blocked = false;
    throw new Error("process died before ack");
} }); await assert.rejects(f.app.executeNext(context, { jobId: p.jobId })); assert.equal(f.state.contact.length, 2); assert.equal(f.state.crmMigrationRowReceipt.length, 2); f.setHook(null); await f.finish(p.jobId); assert.equal(f.state.contact.length, 2); assert.equal((await f.app.report(context, { jobId: p.jobId })).reconciliation.ok, true); });
test("invalid rows and in-file duplicates remain separate, paginatable outcomes", async (t) => { const f = await setup(t); const p = await f.prepare("Name,Email\nAlice,alice@example.test\nAlice,ALICE@example.test\n,broken\nBlank,\n"); assert.equal(p.stats.errorRows, 3); await f.finish(p.jobId); const r = await f.app.report(context, { jobId: p.jobId }); assert.equal(r.created, 1); assert.equal(r.rejected, 3); assert.equal(r.rows.length, 4); assert.equal(r.reconciliation.ok, true); assert.equal(JSON.stringify(r).includes("broken"), false); });
test("source and plan tampering prevent writes", async (t) => { const f = await setup(t); const p = await f.prepare(); f.state.crmMigrationJob[0].mapping.planIdentity = "forged"; await rejectsCode(f.app.executeNext(context, { jobId: p.jobId }), "PLAN_CHANGED"); assert.equal(f.state.contact.length, 0); });
test("membership revocation between preview and execute prevents all writes", async (t) => { const f = await setup(t); const p = await f.prepare(); f.state.member = []; await rejectsCode(f.app.executeNext(context, { jobId: p.jobId }), "FORBIDDEN"); assert.equal(f.state.contact.length, 0); });
test("cancellation is idempotent, stops new batches and does not claim rollback", async (t) => { const f = await setup(t); const p = await f.prepare(); await f.app.cancel(context, { jobId: p.jobId }); await f.app.cancel(context, { jobId: p.jobId }); await assert.rejects(f.app.executeNext(context, { jobId: p.jobId })); assert.equal(f.state.contact.length, 0); assert.equal((await f.app.report(context, { jobId: p.jobId })).remaining, 2); });
test("rollback previews first, requires exact confirmation, archives only own unchanged rows", async (t) => { const f = await setup(t); const p = await f.prepare(); await f.finish(p.jobId); const dry = await f.app.rollback(context, { jobId: p.jobId }); assert.deepEqual(dry.rows.map(x => x.result), ["CAN_ARCHIVE", "CAN_ARCHIVE"]); assert.equal(f.state.contact[0].archivedAt, null); await rejectsCode(f.app.rollback(context, { jobId: p.jobId, apply: true, confirmation: "wrong" }), "CONFIRMATION_REQUIRED"); const applied = await f.app.rollback(context, { jobId: p.jobId, apply: true, confirmation: p.jobId }); assert.equal(applied.destructiveDelete, false); assert.deepEqual(applied.rows.map(x => x.result), ["ARCHIVED", "ARCHIVED"]); assert.equal(f.state.contact.length, 2); assert.equal((await f.app.report(context, { jobId: p.jobId })).rolledBack, 2); });
test("rollback will not archive edited or linked CRM records", async (t) => { const f = await setup(t); const p = await f.prepare(); await f.finish(p.jobId); f.state.contact[0].updatedAt = new Date("2026-09-15"); f.state.activity.push({ contactId: f.state.contact[1].id }); const r = await f.app.rollback(context, { jobId: p.jobId, apply: true, confirmation: p.jobId }); assert.deepEqual(r.rows.map(x => x.result), ["RECORD_CHANGED", "RECORD_IN_USE"]); assert.equal(f.state.contact.filter(x => x.archivedAt).length, 0); });
test("sources used by jobs are retained; unused sources can be tombstoned and physically removed", async (t) => { const f = await setup(t); const p = await f.prepare(); await rejectsCode(f.app.removeSource(context, { sourceId: p.upload.source.id, expectedSha256: p.upload.source.sha256 }), "SOURCE_IN_USE"); const s = await f.upload(); await f.app.removeSource(context, { sourceId: s.source.id, expectedSha256: s.source.sha256 }); await rejectsCode(f.app.preview(context, { sourceId: s.source.id, expectedSha256: s.source.sha256 }), "NOT_FOUND"); assert.equal((await f.app.list(context)).sources.length, 1); });
test("company imports use source evidence and create-only exact duplicate checks", async (t) => { const f = await setup(t); const u = await f.upload("Company,Domain\nAcme,ACME.test\nOther,acme.test\n"); const p = await f.app.prepare(context, { sourceId: u.source.id, expectedSha256: u.source.sha256, entityType: "company", mapping: [{ source: "Company", target: "name" }, { source: "Domain", target: "domain" }], commandId: "companies" }); await f.finish(p.jobId); const r = await f.app.report(context, { jobId: p.jobId }); assert.equal(f.state.company.length, 1); assert.equal(r.created, 1); assert.equal(r.duplicates, 1); });
test("report refuses ambiguous row accounting instead of claiming completion", async (t) => { const f = await setup(t); const p = await f.prepare(); await f.finish(p.jobId); f.state.crmMigrationJob[0].acceptedRows = 50; assert.equal((await f.app.report(context, { jobId: p.jobId })).reconciliation.ok, false); });
test("a lease that expires during CRM writes aborts the entire write transaction", async (t) => { const f = await setup(t); const p = await f.prepare(); let fired = false; f.setHook((m, o) => { if (!fired && m === "contact" && o === "create") {
    fired = true;
    f.setNow("2026-09-14T10:03:00Z");
} }); await rejectsCode(f.app.executeNext(context, { jobId: p.jobId }), "LEASE_LOST"); assert.equal(f.state.contact.length, 0); f.setHook(null); await f.finish(p.jobId); assert.equal(f.state.contact.length, 2); });
test("distinct contacts matching email and phone are rejected, never silently merged", async (t) => { const f = await setup(t); f.state.contact.push({ id: "first", email: "alice@example.test", archivedAt: null }, { id: "second", phone: "+998901234567", archivedAt: null }); const u = await f.upload("Name,Email,Phone\nAlice,alice@example.test,901234567\n"); const p = await f.app.prepare(context, { sourceId: u.source.id, expectedSha256: u.source.sha256, entityType: "contact", mapping: [...mapping, { source: "Phone", target: "phone" }], commandId: "ambiguous" }); await f.finish(p.jobId); const report = await f.app.report(context, { jobId: p.jobId }); assert.equal(report.rows[0].code, "AMBIGUOUS_DUPLICATE"); assert.equal(report.rejected, 1); assert.equal(f.state.contact.length, 2); });
test("a replacement admin cannot assign newly imported records to a removed owner", async (t) => { const f = await setup(t); const p = await f.prepare(); f.state.member = f.state.member.filter(m => m.userId !== context.actorId); await rejectsCode(f.app.executeNext({ ...context, actorId: "owner-a" }, { jobId: p.jobId }), "OWNER_NOT_MEMBER"); assert.equal(f.state.contact.length, 0); });
test("two application instances replay one prepared job instead of allocating duplicate intents", async (t) => { const f = await setup(t); const u = await f.upload(); const args = { sourceId: u.source.id, expectedSha256: u.source.sha256, entityType: "contact", mapping, commandId: "same" }; const results = await Promise.all([f.app.prepare(context, args), f.make().prepare(context, args)]); assert.equal(results[0].jobId, results[1].jobId); assert.equal(f.state.crmMigrationJob.length, 1); });
test("multi-batch report pagination does not truncate row outcomes silently", async (t) => { const f = await setup(t); const p = await f.prepare("Name,Email\n" + Array.from({ length: 123 }, (_, i) => `Person ${i},person-${i}@example.test`).join("\n")); await f.finish(p.jobId); const a = await f.app.report(context, { jobId: p.jobId }); const b = await f.app.report(context, { jobId: p.jobId, afterRow: a.nextAfterRow }); assert.equal(a.rows.length, 100); assert.equal(b.rows.length, 23); assert.equal(new Set([...a.rows, ...b.rows].map(r => r.rowNumber)).size, 123); assert.equal(a.reconciliation.ok, true); });
for (const [model, key] of [["calendarAttendee", "contactId"], ["contactBrief", "contactId"], ["company", "primaryContactId"]]) {
    test(`rollback preserves imported contacts referenced by ${model}`, async (t) => { const f = await setup(t); const p = await f.prepare(); await f.finish(p.jobId); f.state[model].push({ [key]: f.state.contact[0].id }); const r = await f.app.rollback(context, { jobId: p.jobId, apply: true, confirmation: p.jobId }); assert.equal(r.rows[0].result, "RECORD_IN_USE"); assert.equal(f.state.contact[0].archivedAt, null); });
}

test("full report export is one persisted snapshot, not the current 100-row page", async t => {
  const f=await setup(t);const csv="Name,Email\n"+Array.from({length:125},(_,i)=>`Person ${i},person-${i}@example.test`).join("\n")+"\n";
  const p=await f.prepare(csv);await f.finish(p.jobId);
  const page=await f.app.report(context,{jobId:p.jobId});assert.equal(page.rows.length,100);assert.notEqual(page.nextAfterRow,null);
  const out=await f.app.exportReport(context,{jobId:p.jobId});
  const {parseCsv}=await import("@crm/migration-core");const parsed=parseCsv(out.content);
  assert.equal(parsed.rows.length,126);assert.equal(parsed.rows[0][0],"SUMMARY");assert.equal(out.rowCount,125);assert.equal(out.remaining,0);assert.equal(out.reconciled,true);
  assert.match(out.filename,/^migration-[A-Za-z0-9_-]+-report\.csv$/);assert.equal(out.content.charCodeAt(0),0xfeff);
  assert.equal(new Set(parsed.rows.slice(1).map(row=>row[9])).size,125);
  assert.equal(f.state.crmMigrationEvent.filter(x=>x.type==="migration.report.exported"||x.eventType==="migration.report.exported").length,1);
});
test("report CSV neutralizes formula-shaped metadata and includes no raw client contact fields", async t => {
  const f=await setup(t);const p=await f.prepare();await f.finish(p.jobId);
  f.state.crmMigrationJob[0].sourceFilename='=HYPERLINK("https://invalid.example")';
  const out=await f.app.exportReport(context,{jobId:p.jobId});const {parseCsv}=await import("@crm/migration-core");
  assert.ok(parseCsv(out.content).rows.every(r=>r[2].startsWith("'=")));assert.equal(out.content.includes("alice@example.test"),false);
});
test("export is reauthorized and never presents an active import as a final report", async t => {
  const f=await setup(t);const p=await f.prepare();await rejectsCode(f.app.exportReport(context,{jobId:p.jobId}),"JOB_ACTIVE");
  await f.app.cancel(context,{jobId:p.jobId});const out=await f.app.exportReport(context,{jobId:p.jobId});
  assert.equal(out.remaining,2);assert.equal(out.rowCount,0);assert.equal(out.reconciled,false); const {parseCsv}=await import("@crm/migration-core"); assert.equal(parseCsv(out.content).rows[0][6],"2");
  f.state.member[0].role="member";await rejectsCode(f.app.exportReport(context,{jobId:p.jobId}),"FORBIDDEN");
  await rejectsCode(f.app.exportReport({...context,tenantId:"other"},{jobId:p.jobId}),"FORBIDDEN");
});
test("export audit failure aborts the download instead of silently losing its access record", async t => {
  const f=await setup(t);const p=await f.prepare();await f.finish(p.jobId);
  f.setHook((model,op)=>{if(model==="crmMigrationEvent"&&op==="create")throw new Error("audit unavailable");});
  await assert.rejects(f.app.exportReport(context,{jobId:p.jobId}),/audit unavailable/);
});

// Source lifecycle uses the real encrypted filesystem store and a serialized DB contract double.
test('source deletion persists intent, audit and physical-purge acknowledgement', async t => {
  const f = await setup(t), u = await f.upload();
  const input = {sourceId:u.source.id,expectedSha256:u.source.sha256};
  await f.app.removeSource(context,input); await f.make().removeSource(context,input);
  assert.ok(f.state.crmMigrationSource[0].deletedAt); assert.ok(f.state.crmMigrationSource[0].purgedAt);
  assert.deepEqual(f.state.crmMigrationSourceEvent.map(e=>e.type),['source.deletion.requested','source.purge.completed']);
  await rejectsCode(f.store.get({context,...input}), 'SOURCE_NOT_FOUND');
});
test('deletion audit failure rolls back intent and leaves encrypted bytes intact', async t=>{
  const f=await setup(t),u=await f.upload(); f.setHook((m,o)=>{if(m==='crmMigrationSourceEvent'&&o==='create') throw new Error('audit down');});
  await assert.rejects(f.app.removeSource(context,{sourceId:u.source.id,expectedSha256:u.source.sha256}),/audit down/);
  assert.equal(f.state.crmMigrationSource[0].deletedAt,null); assert.equal((await f.store.get({context,sourceId:u.source.id})).id,u.source.id);
});
test('crash after tombstone leaves visible pending purge and a new process can finish', async t=>{
  const f=await setup(t),u=await f.upload();
  const broken=f.make({sourceStore:{...f.store,remove:async()=>{throw new Error('volume offline');}}});
  await assert.rejects(broken.removeSource(context,{sourceId:u.source.id,expectedSha256:u.source.sha256}),/volume offline/);
  assert.ok(f.state.crmMigrationSource[0].deletedAt);assert.equal(f.state.crmMigrationSource[0].purgedAt,null);
  assert.equal((await f.app.list(context)).sources[0].deleted,true);
  await f.make().removeSource(context,{sourceId:u.source.id,expectedSha256:u.source.sha256});assert.ok(f.state.crmMigrationSource[0].purgedAt);
});
test('lost purge acknowledgement is reconciled from absent file without resurrecting source', async t=>{
  const f=await setup(t),u=await f.upload();let once=true;
  f.setHook((m,o,a)=>{if(once&&m==='crmMigrationSourceEvent'&&o==='create'&&a.data.type==='source.purge.completed'){once=false;throw new Error('lost commit');}});
  await assert.rejects(f.app.removeSource(context,{sourceId:u.source.id,expectedSha256:u.source.sha256}),/lost commit/);
  assert.ok(f.state.crmMigrationSource[0].deletedAt); assert.equal(f.state.crmMigrationSource[0].purgedAt,null);
  await rejectsCode(f.store.get({context,sourceId:u.source.id}),'SOURCE_NOT_FOUND');f.setHook(null);
  const plan=await f.make().cleanupSources(context);assert.equal(plan.candidates[0].kind,'PENDING_PURGE');
  const done=await f.make().cleanupSources(context,{cutoff:plan.cutoff,apply:true,expectedPlanHash:plan.planHash});
  assert.equal(done.results[0].status,'PURGED');assert.ok(f.state.crmMigrationSource[0].purgedAt);
});
test('retention is preview-first and protects recently uploaded and all job-referenced sources', async t=>{
  const f=await setup(t),p=await f.prepare();await f.finish(p.jobId);const old=await f.upload();
  f.setNow('2026-11-18T12:00:00Z');await f.upload();const preview=await f.app.cleanupSources(context);
  assert.equal(preview.applied,false);assert.deepEqual(preview.candidates.map(x=>x.sourceId),[old.source.id]);assert.equal(preview.protectedCount,1);
  await rejectsCode(f.app.cleanupSources(context,{cutoff:preview.cutoff,apply:true,expectedPlanHash:'0'.repeat(64)}),'SOURCE_CHANGED');
  const applied=await f.app.cleanupSources(context,{cutoff:preview.cutoff,apply:true,expectedPlanHash:preview.planHash});
  assert.equal(applied.results[0].status,'PURGED');assert.equal(f.state.crmMigrationRowReceipt.length,2);
  assert.equal((await f.store.get({context,sourceId:p.upload.source.id})).id,p.upload.source.id);
});
test('creating a job after cleanup preview invalidates the destructive plan', async t=>{
  const f=await setup(t),u=await f.upload();f.setNow('2026-11-18');const preview=await f.app.cleanupSources(context);
  await f.app.prepare(context,{sourceId:u.source.id,expectedSha256:u.source.sha256,entityType:'contact',mapping,commandId:'new-job'});
  await rejectsCode(f.app.cleanupSources(context,{cutoff:preview.cutoff,apply:true,expectedPlanHash:preview.planHash}),'SOURCE_CHANGED');
  assert.equal(f.state.crmMigrationSource[0].deletedAt,null);
});
test('source tombstone prevents late plan publication and new CRM writes', async t=>{
  const f=await setup(t),u=await f.upload();await f.app.removeSource(context,{sourceId:u.source.id,expectedSha256:u.source.sha256});
  await rejectsCode(f.app.prepare(context,{sourceId:u.source.id,expectedSha256:u.source.sha256,entityType:'contact',mapping,commandId:'late'}),'NOT_FOUND');
  assert.equal(f.state.crmMigrationJob.length,0);
});
test('authenticated old orphan cleanup reserves a tombstone before deleting source bytes', async t=>{
  const f=await setup(t);const s=await f.store.put({context,filename:'lost.csv',mimeType:'text/csv',bytes:Buffer.from('Name,Email\nA,a@example.test\n')});
  f.setNow('2027-01-01');const p=await f.app.cleanupSources(context);assert.equal(p.candidates[0].kind,'ORPHAN');
  const r=await f.make().cleanupSources(context,{cutoff:p.cutoff,apply:true,expectedPlanHash:p.planHash});assert.equal(r.results[0].status,'PURGED');
  assert.ok(f.state.crmMigrationSource[0].purgedAt);assert.equal(f.state.crmMigrationSource[0].deleteReason,'ORPHAN');
  await assert.rejects(f.db.crmMigrationSource.create({data:{id:s.id,workspaceId:context.tenantId}}),e=>e.code==='P2002');
});
test('cleanup denies a revoked admin and does not accept a newer-than-retention cutoff', async t=>{
  const f=await setup(t);await f.upload();await rejectsCode(f.app.cleanupSources(context,{cutoff:'2026-09-14'}),'INVALID_INPUT');
  await rejectsCode(f.app.cleanupSources(context,{cutoff:'invalid'}),'INVALID_INPUT');
  f.state.member[0].role='member';await rejectsCode(f.app.cleanupSources(context),'FORBIDDEN');
  await rejectsCode(f.app.cleanupSources({...context,tenantId:'workspace-b'}),'FORBIDDEN');
});
test('tampered encrypted source is never force-deleted by recovery cleanup', async t=>{
  const f=await setup(t),u=await f.upload();const {writeFile}=await import('node:fs/promises');const dir=(await readdir(f.root))[0];
  const fp=path.join(f.root,dir,`${u.source.id}.source`);await writeFile(fp,'corrupted');
  await assert.rejects(f.app.removeSource(context,{sourceId:u.source.id,expectedSha256:u.source.sha256}));
  assert.ok(f.state.crmMigrationSource[0].deletedAt);assert.equal(f.state.crmMigrationSource[0].purgedAt,null);
  assert.equal((await readFile(fp,'utf8')),'corrupted');
});
test('fresh orphan is excluded until both encrypted timestamp and filesystem grace expire', async t=>{
  const f=await setup(t);f.setNow(new Date().toISOString());
  await f.store.put({context,filename:'fresh.csv',mimeType:'text/csv',bytes:Buffer.from('Name,Email\nA,a@example.test\n')});
  assert.equal((await f.app.cleanupSources(context)).candidates.length,0);
});

test('background import requires deployment flag and explicit consent for the exact job',async t=>{
  const f=await setup(t),p=await f.prepare();await rejectsCode(f.app.setBackground(context,{jobId:p.jobId,enabled:true,confirmation:p.jobId}),'BACKGROUND_DISABLED');
  const bg=f.make({backgroundEnabled:true});await rejectsCode(bg.setBackground(context,{jobId:p.jobId,enabled:true,confirmation:'other'}),'CONFIRMATION_REQUIRED');
  await bg.runBackgroundOnce();assert.equal(f.state.contact.length,0);assert.equal(f.state.crmMigrationJob[0].status,'READY');
  await bg.setBackground(context,{jobId:p.jobId,enabled:true,confirmation:p.jobId});
  const version=f.state.crmMigrationJob[0].backgroundVersion;await bg.setBackground(context,{jobId:p.jobId,enabled:true,confirmation:p.jobId});assert.equal(f.state.crmMigrationJob[0].backgroundVersion,version);
  await rejectsCode(bg.executeNext(context,{jobId:p.jobId}),'BACKGROUND_ACTIVE');
});
test('background worker completes multiple batches across independent application instances',async t=>{
  const f=await setup(t,{backgroundEnabled:true}),p=await f.prepare('Name,Email\n'+Array.from({length:123},(_,i)=>`P${i},b-${i}@example.test`).join('\n'));
  await f.app.setBackground(context,{jobId:p.jobId,enabled:true,confirmation:p.jobId});
  for(let i=0;i<5;i++){f.setNow(new Date(Date.parse('2026-09-14T10:00:00Z')+i*10000).toISOString());await f.make().runBackgroundOnce();}
  const r=await f.app.report(context,{jobId:p.jobId});assert.equal(r.status,'COMPLETED');assert.equal(r.created,123);assert.equal(r.reconciliation.ok,true);assert.equal(f.state.crmMigrationJob[0].backgroundEnabled,false);
});
test('worker rechecks requester permissions and never substitutes its own privileges',async t=>{
  const f=await setup(t,{backgroundEnabled:true}),p=await f.prepare();await f.app.setBackground(context,{jobId:p.jobId,enabled:true,confirmation:p.jobId});
  f.state.member[0].role='member';await f.app.runBackgroundOnce();assert.equal(f.state.contact.length,0);assert.equal(f.state.crmMigrationJob[0].backgroundEnabled,false);assert.equal(f.state.crmMigrationJob[0].backgroundLastErrorCode,'FORBIDDEN');
});
test('pause during source loading prevents the next claim and does not fail the job',async t=>{
  const f=await setup(t,{backgroundEnabled:true}),p=await f.prepare();await f.app.setBackground(context,{jobId:p.jobId,enabled:true,confirmation:p.jobId});
  let once=true;const bg=f.make({sourceStore:{...f.store,get:async args=>{if(once){once=false;await f.app.setBackground(context,{jobId:p.jobId,enabled:false});}return f.store.get(args);}}});
  await bg.runBackgroundOnce();assert.equal(f.state.contact.length,0);assert.equal(f.state.crmMigrationJob[0].backgroundEnabled,false);assert.notEqual(f.state.crmMigrationJob[0].status,'FAILED');
  await f.finish(p.jobId);assert.equal(f.state.contact.length,2);
});
test('a pause drains a claimed batch but stale worker acknowledgement cannot re-enable scheduling',async t=>{
  const f=await setup(t,{backgroundEnabled:true}),p=await f.prepare();await f.app.setBackground(context,{jobId:p.jobId,enabled:true,confirmation:p.jobId});let fired=false;
  f.setHook((m,o,a)=>{if(!fired&&m==='crmMigrationBatch'&&o==='updateMany'&&a.data.status==='RUNNING'){fired=true;f.state.crmMigrationJob[0].backgroundEnabled=false;f.state.crmMigrationJob[0].backgroundVersion++;}});
  await f.app.runBackgroundOnce();assert.equal(f.state.contact.length,2);assert.equal(f.state.crmMigrationJob[0].backgroundEnabled,false);assert.notEqual(f.state.crmMigrationJob[0].status,'FAILED');
});
test('revoked original owner cannot be silently replaced by a worker requester',async t=>{
  const f=await setup(t,{backgroundEnabled:true}),p=await f.prepare();const other={...context,actorId:'owner-a'};
  await f.app.setBackground(other,{jobId:p.jobId,enabled:true,confirmation:p.jobId});f.state.member=f.state.member.filter(m=>m.userId!==context.actorId);
  await f.app.runBackgroundOnce();assert.equal(f.state.contact.length,0);assert.equal(f.state.crmMigrationJob[0].backgroundLastErrorCode,'OWNER_NOT_MEMBER');
});
test('lost batch acknowledgement with transient database error retries receipts, not CRM creation',async t=>{
  const f=await setup(t,{backgroundEnabled:true}),p=await f.prepare();await f.app.setBackground(context,{jobId:p.jobId,enabled:true,confirmation:p.jobId});let once=true;
  f.setHook((m,o,a)=>{if(once&&m==='crmMigrationBatch'&&o==='updateMany'&&a.data.status==='COMPLETED'){once=false;throw Object.assign(new Error('connection lost'),{code:'P1001'});}});
  await f.app.runBackgroundOnce();assert.equal(f.state.contact.length,2);assert.equal(f.state.crmMigrationJob[0].backgroundEnabled,true);
  f.setHook(null);f.setNow('2026-09-14T10:01:00Z');await f.make().runBackgroundOnce();f.setNow('2026-09-14T10:01:10Z');await f.make().runBackgroundOnce();
  assert.equal(f.state.contact.length,2);assert.equal((await f.app.report(context,{jobId:p.jobId})).reconciliation.ok,true);
});
test('unknown worker errors suspend processing without logging sensitive exception text',async t=>{
  const f=await setup(t,{backgroundEnabled:true}),p=await f.prepare();await f.app.setBackground(context,{jobId:p.jobId,enabled:true,confirmation:p.jobId});
  const bg=f.make({sourceStore:{...f.store,get:async()=>{throw new Error('SENSITIVE credential text');}}});
  const result=await bg.runBackgroundOnce();assert.equal(f.state.crmMigrationJob[0].backgroundEnabled,false);assert.equal(JSON.stringify(result).includes('SENSITIVE'),false);
  assert.equal(JSON.stringify(f.state.crmMigrationEvent).includes('SENSITIVE'),false);assert.equal(f.state.contact.length,0);
});
test('cancellation clears consent and worker claims; it is not interpreted as pause/resume',async t=>{
  const f=await setup(t,{backgroundEnabled:true}),p=await f.prepare();await f.app.setBackground(context,{jobId:p.jobId,enabled:true,confirmation:p.jobId});await f.app.cancel(context,{jobId:p.jobId});
  await f.app.runBackgroundOnce();assert.equal(f.state.contact.length,0);assert.equal(f.state.crmMigrationJob[0].backgroundEnabled,false);
  await rejectsCode(f.app.setBackground(context,{jobId:p.jobId,enabled:true,confirmation:p.jobId}),'JOB_TERMINAL');
});
test('worker ticks are bounded and an already-aborted signal processes no job',async t=>{
  const f=await setup(t,{backgroundEnabled:true}),p=await f.prepare();await f.app.setBackground(context,{jobId:p.jobId,enabled:true,confirmation:p.jobId});
  const c=new AbortController();c.abort();await f.app.runBackgroundOnce({signal:c.signal});assert.equal(f.state.contact.length,0);
  await rejectsCode(f.app.runBackgroundOnce({limit:0}),'INVALID_INPUT');await rejectsCode(f.app.runBackgroundOnce({limit:11}),'INVALID_INPUT');
});
test('source cleanup protects files needed by an opted-in background import',async t=>{
  const f=await setup(t,{backgroundEnabled:true}),p=await f.prepare();await f.app.setBackground(context,{jobId:p.jobId,enabled:true,confirmation:p.jobId});f.setNow('2026-12-01');
  assert.equal((await f.app.cleanupSources(context)).candidates.length,0);await rejectsCode(f.app.removeSource(context,{sourceId:p.upload.source.id,expectedSha256:p.upload.source.sha256}),'SOURCE_IN_USE');
});

test('two competing worker instances cannot claim the same queue lease',async t=>{
  const f=await setup(t,{backgroundEnabled:true}),p=await f.prepare();await f.app.setBackground(context,{jobId:p.jobId,enabled:true,confirmation:p.jobId});
  await Promise.all([f.app.runBackgroundOnce(),f.make().runBackgroundOnce()]);
  assert.equal(f.state.contact.length,2);assert.equal(f.state.crmMigrationRowReceipt.length,2);assert.equal(f.state.crmMigrationBatch[0].attemptCount,1);
});
test('persisted queue claim recovers after lease expiry without changing the import intent',async t=>{
  const f=await setup(t,{backgroundEnabled:true}),p=await f.prepare();await f.app.setBackground(context,{jobId:p.jobId,enabled:true,confirmation:p.jobId});
  f.state.crmMigrationJob[0].backgroundNextAttemptAt=new Date('2026-09-14T10:03:00Z');f.state.crmMigrationJob[0].backgroundVersion++;
  await f.make().runBackgroundOnce();assert.equal(f.state.contact.length,0);f.setNow('2026-09-14T10:04:00Z');await f.make().runBackgroundOnce();
  assert.equal(f.state.contact.length,2);assert.equal(f.state.crmMigrationJob.length,1);
});
test('cleanup fails closed if a source audit cannot be saved after physical removal',async t=>{
  const f=await setup(t),u=await f.upload();f.setNow('2026-12-01');const preview=await f.app.cleanupSources(context);
  f.setHook((m,o,a)=>{if(m==='crmMigrationSourceEvent'&&o==='create'&&a.data.type==='source.purge.completed')throw new Error('unavailable');});
  const result=await f.app.cleanupSources(context,{cutoff:preview.cutoff,apply:true,expectedPlanHash:preview.planHash});assert.equal(result.results[0].status,'REVIEW_REQUIRED');assert.equal(f.state.crmMigrationSource[0].purgedAt,null);
  f.setHook(null);await f.make().removeSource(context,{sourceId:u.source.id,expectedSha256:u.source.sha256});assert.ok(f.state.crmMigrationSource[0].purgedAt);
});
