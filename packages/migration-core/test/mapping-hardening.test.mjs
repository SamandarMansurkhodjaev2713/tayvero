import assert from 'node:assert/strict';
import test from 'node:test';
import { compileMapping, mapRow, createMigrationDryRun } from '../src/index.mjs';
const base = { headers: ['Name'], mapping: [{ source: 'Name', target: 'name' }], targetSchema: { name: { type: 'string', required: true } } };
const rejects = (fn, code) => assert.throws(fn, error => error?.code === code);
test('rejects inherited targets instead of resolving Object.prototype', () => rejects(() => compileMapping({ ...base, mapping: [{ source: 'Name', target: 'toString' }] }), 'UNKNOWN_TARGET_FIELD'));
test('rejects prototype transformer names', () => rejects(() => compileMapping({ ...base, targetSchema: { name: { type: 'toString' } } }), 'INVALID_TARGET_FIELD'));
test('rejects duplicate and blank headers without choosing an arbitrary column', () => {
    rejects(() => compileMapping({ ...base, headers: ['Name', 'Name'] }), 'INVALID_HEADERS');
    rejects(() => compileMapping({ ...base, headers: ['Name', ' '] }), 'INVALID_HEADERS');
});
test('compiled defaults are immutable snapshots, not caller-owned objects', () => {
    const schema = { name: { type: 'string' }, status: { type: 'string', default: 'new' } };
    const compiled = compileMapping({ ...base, targetSchema: schema });
    schema.status.default = 'injected';
    assert.equal(mapRow(['A'], compiled).status, 'new');
    assert.equal(Object.isFrozen(compiled.targetSchema.status), true);
});
test('accessor field definitions are rejected without invoking them', () => {
    let invoked = 0;
    const field = {};
    Object.defineProperty(field, 'type', { enumerable: true, get() { invoked++; return 'string'; } });
    rejects(() => compileMapping({ ...base, targetSchema: { name: field } }), 'INVALID_TARGET_FIELD');
    assert.equal(invoked, 0);
});
test('rejects object defaults and unsafe reserved destination fields', () => {
    rejects(() => compileMapping({ ...base, targetSchema: { ...base.targetSchema, bad: { type: 'string', default: {} } } }), 'INVALID_DEFAULT');
    rejects(() => compileMapping({ ...base, targetSchema: { tenantId: { type: 'string' } }, mapping: [{ source: 'Name', target: 'tenantId' }] }), 'INVALID_TARGET_FIELD');
});
test('rejects non-cell values rather than executing coercion hooks', () => {
    const compiled = compileMapping(base);
    let invoked = 0;
    rejects(() => mapRow([{ toString() { invoked++; return 'A'; } }], compiled), 'INVALID_CELL');
    assert.equal(invoked, 0);
});
test('rejects unsupported entity types before creating an executable migration plan', () => {
    rejects(() => createMigrationDryRun({ tenantId: 'w', entityType: 'user', compiledMapping: compileMapping(base), rows: [['A']] }), 'INVALID_ENTITY_TYPE');
});
