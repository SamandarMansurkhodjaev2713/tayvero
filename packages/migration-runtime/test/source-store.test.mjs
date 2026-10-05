import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, readFile, writeFile, stat, rm, symlink, chmod, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createEncryptedFileSourceStore } from '../src/source-store.mjs';
import { createMigrationSourcePreparation } from '../src/source-preparation.mjs';
const context = { tenantId: 'tenant-a', actorId: 'operator' };
const bytes = Buffer.from('Name,Email\nAlice,alice@example.test\nBob,bob@example.test\n');
async function fixture(t, extra = {}) {
    const root = await mkdtemp(path.join(tmpdir(), 'crm-source-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const key = randomBytes(32);
    const options = { root, keys: { k1: key }, activeKeyId: 'k1', ...extra };
    const store = await createEncryptedFileSourceStore(options);
    return { root, key, options, store, put: () => store.put({ context, filename: 'customers.csv', mimeType: 'text/csv', bytes }) };
}
test('real filesystem encrypted source survives a fresh process and contains no plaintext customer data', async (t) => {
    const f = await fixture(t);
    const source = await f.put();
    const dir = path.join(f.root, (await readdir(f.root))[0]);
    const file = path.join(dir, (await readdir(dir))[0]);
    const raw = await readFile(file);
    for (const value of ['Alice', 'alice@example.test', 'customers.csv'])
        assert.ok(!raw.includes(Buffer.from(value)));
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    const url = new URL('../src/source-store.mjs', import.meta.url).href;
    const script = `import {createEncryptedFileSourceStore} from ${JSON.stringify(url)}; const s=await createEncryptedFileSourceStore({root:process.env.SOURCE_ROOT,keys:{k1:Buffer.from(process.env.SOURCE_KEY,'hex')},activeKeyId:'k1'}); const v=await s.get({context:{tenantId:'tenant-a',actorId:'operator'},sourceId:process.env.SOURCE_ID,expectedSha256:process.env.SOURCE_SHA}); console.log(JSON.stringify({sha256:v.sha256,size:v.bytes.length}));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, SOURCE_ROOT: f.root, SOURCE_KEY: f.key.toString('hex'), SOURCE_ID: source.id, SOURCE_SHA: source.sha256 }, timeout: 10000 });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { sha256: source.sha256, size: bytes.length });
});
test('same source bytes can be uploaded as distinct import intents', async (t) => {
    const f = await fixture(t);
    const a = await f.put(), b = await f.put();
    assert.notEqual(a.id, b.id);
    assert.equal(a.sha256, b.sha256);
});
test('tenant, hash and ciphertext tampering fail closed', async (t) => {
    const f = await fixture(t);
    const a = await f.put();
    await assert.rejects(f.store.get({ context: { ...context, tenantId: 'tenant-b' }, sourceId: a.id }), { code: 'SOURCE_NOT_FOUND' });
    await assert.rejects(f.store.get({ context, sourceId: a.id, expectedSha256: '0'.repeat(64) }), { code: 'SOURCE_INTEGRITY' });
    const dir = path.join(f.root, (await readdir(f.root))[0]);
    const file = path.join(dir, `${a.id}.source`);
    const data = await readFile(file);
    data[data.length - 1] ^= 1;
    await writeFile(file, data);
    await assert.rejects(f.store.get({ context, sourceId: a.id }), { code: 'SOURCE_INTEGRITY' });
});
test('old source keys remain readable across active-key rotation', async (t) => {
    const f = await fixture(t);
    const a = await f.put();
    const store = await createEncryptedFileSourceStore({ ...f.options, keys: { k1: f.key, k2: randomBytes(32) }, activeKeyId: 'k2' });
    assert.deepEqual((await store.get({ context, sourceId: a.id })).bytes, bytes);
    const lost = await createEncryptedFileSourceStore({ ...f.options, keys: { k2: randomBytes(32) }, activeKeyId: 'k2' });
    await assert.rejects(lost.get({ context, sourceId: a.id }), { code: 'SOURCE_KEY_UNAVAILABLE' });
});
test('opaque identifiers, file limits and symlinks cannot access arbitrary paths', async (t) => {
    const f = await fixture(t, { maxBytes: 1000 });
    const a = await f.put();
    await assert.rejects(f.store.get({ context, sourceId: '../secrets' }), { code: 'INVALID_SOURCE_ID' });
    await assert.rejects(f.store.put({ context, filename: '../file.csv', mimeType: 'text/csv', bytes }), { code: 'INVALID_SOURCE_FILENAME' });
    await assert.rejects(f.store.put({ context, filename: 'file.csv', mimeType: 'text/csv', bytes: Buffer.alloc(1001) }), { code: 'SOURCE_SIZE_LIMIT' });
    const dir = path.join(f.root, (await readdir(f.root))[0]);
    const file = path.join(dir, `${a.id}.source`);
    await rm(file);
    await symlink('/etc/passwd', file);
    await assert.rejects(f.store.get({ context, sourceId: a.id }), { code: 'UNSAFE_SOURCE_FILE' });
});
test('concurrent ID collision publishes exactly one source without overwriting', async (t) => {
    const f = await fixture(t, { idFactory: () => 'a'.repeat(32) });
    const results = await Promise.allSettled([f.put(), f.put()]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'SOURCE_ALREADY_EXISTS');
    const dir = path.join(f.root, (await readdir(f.root))[0]);
    assert.deepEqual(await readdir(dir), ['a'.repeat(32) + '.source']);
});
test('preparation plans from reloaded persisted bytes, preserving physical source rows', async (t) => {
    const f = await fixture(t);
    const a = createMigrationSourcePreparation({ store: f.store });
    const upload = await a.upload({ context, filename: 'customers.csv', mimeType: 'text/csv', bytes: Buffer.from('Name,Email\nAlice,a@example.test\n\nBob,b@example.test\n') });
    const storeB = await createEncryptedFileSourceStore(f.options);
    const b = createMigrationSourcePreparation({ store: storeB });
    const result = await b.plan({ context, sourceId: upload.source.id, expectedSha256: upload.source.sha256, entityType: 'contact', mapping: [{ source: 'Email', target: 'email' }], targetSchema: { email: { type: 'email', required: true } } });
    assert.equal(result.plan.stats.validRows, 2);
    assert.deepEqual(result.plan.batches[0].records.map(x => x.record.sourceRowNumber), [2, 4]);
});
test('unsupported XLSX and invalid UTF-8 are rejected before storage side effects', async (t) => {
    const f = await fixture(t);
    const prep = createMigrationSourcePreparation({ store: f.store });
    await assert.rejects(prep.upload({ context, filename: 'x.xlsx', mimeType: 'application/zip', bytes: Buffer.from([0x50, 0x4b, 3, 4]) }), { code: 'XLSX_ADAPTER_REQUIRED' });
    await assert.rejects(prep.upload({ context, filename: 'x.csv', mimeType: 'text/csv', bytes: Buffer.from([0xff, 0xfe, 0xfa]) }), { code: 'SOURCE_ENCODING' });
    assert.deepEqual(await readdir(f.root), []);
});
test('a private root inside an attacker-writable ancestor is rejected', async (t) => {
    const parent = await mkdtemp(path.join(tmpdir(), 'crm-source-unsafe-'));
    t.after(() => rm(parent, { recursive: true, force: true }));
    await chmod(parent, 0o777);
    await assert.rejects(createEncryptedFileSourceStore({ root: path.join(parent, 'sources'), keys: { k1: randomBytes(32) }, activeKeyId: 'k1' }), { code: 'UNSAFE_SOURCE_DIRECTORY' });
});
test('directory permissions are rechecked when an existing store is used', async (t) => {
    const f = await fixture(t);
    const a = await f.put();
    await chmod(f.root, 0o777);
    await assert.rejects(f.store.get({ context, sourceId: a.id }), { code: 'UNSAFE_SOURCE_DIRECTORY' });
    await assert.rejects(f.put(), { code: 'UNSAFE_SOURCE_DIRECTORY' });
});

test('inventory is tenant-local, bounded and ignores symlinks and unfinished uploads', async t=>{
  const f=await fixture(t),a=await f.put();const dir=path.join(f.root,(await readdir(f.root))[0]);
  await writeFile(path.join(dir,'.upload-in-progress.tmp'),'not a published source');
  await symlink(path.join(dir,`${a.id}.source`),path.join(dir,`${'b'.repeat(32)}.source`));
  const full=await f.store.inventory({context});assert.equal(full.entries.length,1);assert.equal(full.ignored,2);
  const bounded=await f.store.inventory({context,maxEntries:1});assert.equal(bounded.scanned,1);assert.equal(bounded.truncated,true);
  assert.deepEqual((await f.store.inventory({context:{...context,tenantId:'other'}})).entries,[]);
  await assert.rejects(f.store.inventory({context,maxEntries:1001}),{code:'SOURCE_STORE_CONFIG'});
});
test('simultaneous physical purges are idempotent and always require an exact digest',async t=>{
  const f=await fixture(t),a=await f.put();
  await assert.rejects(f.store.remove({context,sourceId:a.id}),{code:'INVALID_SOURCE_DIGEST'});
  const input={context,sourceId:a.id,expectedSha256:a.sha256};
  await Promise.all([f.store.remove(input),f.store.remove(input)]);
  assert.equal((await f.store.remove(input)).removed,false);assert.equal((await f.store.inventory({context})).entries.length,0);
});
test('inventory never enters a symlinked tenant directory',async t=>{
  const f=await fixture(t);await f.put();const dir=path.join(f.root,(await readdir(f.root))[0]);const replacement=await mkdtemp(path.join(tmpdir(),'source-attacker-'));t.after(()=>rm(replacement,{recursive:true,force:true}));
  await rm(dir,{recursive:true,force:true});await symlink(replacement,dir);
  await assert.rejects(f.store.inventory({context}),{code:'UNSAFE_SOURCE_DIRECTORY'});
});

test('a FIFO substituted for source ciphertext is rejected instead of blocking the file reader',async t=>{
  const f=await fixture(t),a=await f.put();const dir=path.join(f.root,(await readdir(f.root))[0]);const file=path.join(dir,`${a.id}.source`);
  await rm(file);const made=spawnSync('mkfifo',['-m','600',file],{encoding:'utf8',timeout:1000});assert.equal(made.status,0,made.stderr);
  await assert.rejects(f.store.get({context,sourceId:a.id}),{code:'UNSAFE_SOURCE_FILE'});
});
