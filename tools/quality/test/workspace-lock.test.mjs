import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseJsonc, workspaceLockFindings } from "../lib/workspace-lock.mjs";
const root = fileURLToPath(new URL('../../../', import.meta.url));
test('JSONC parser preserves quoted URLs and comment-like strings', () => {
    assert.deepEqual(parseJsonc('{"url":"https://example.test/a,]",/* comment */"items":["//",],// x\n}'), { url: 'https://example.test/a,]', items: ['//'] });
    assert.throws(() => parseJsonc('{/* unfinished'));
    assert.throws(() => parseJsonc('{"expression": process.exit(0)}'));
});
test('every declared workspace and local dependency is represented in lock metadata', () => {
    const lock = parseJsonc(readFileSync(new URL('../../../bun.lock', import.meta.url), 'utf8'));
    assert.deepEqual(workspaceLockFindings(root, lock), []);
});
test('missing or stale workspace metadata is a failing finding, not a baseline exemption', () => {
    const lock = parseJsonc(readFileSync(new URL('../../../bun.lock', import.meta.url), 'utf8'));
    delete lock.workspaces['packages/migration-runtime'];
    delete lock.packages['@crm/pipeline-runtime'];
    assert.ok(workspaceLockFindings(root, lock).some(f => f.code === 'WORKSPACE_MISSING'));
    assert.ok(workspaceLockFindings(root, lock).some(f => f.code === 'WORKSPACE_RESOLUTION'));
});
