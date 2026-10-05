import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = p => readFile(new URL(`../../../${p}`, import.meta.url), 'utf8');
test('public migration routes expose consent, not unrestricted worker execution', async () => {
    const router = await read('apps/api/src/migrations/migrations.router.ts');
    assert.match(router, /setBackground/);
    assert.match(router, /cleanupSources/);
    assert.doesNotMatch(router, /runBackgroundOnce/);
    const env = await read('.env.example');
    assert.match(env, /^MIGRATION_BACKGROUND_ENABLED=0$/m);
});
test('source lifecycle schema expands data and preserves receipt/source foreign keys', async () => {
    const a = await read('packages/db/prisma/migrations/20260918090000_migration_source_lifecycle/migration.sql');
    const b = await read('packages/db/prisma/migrations/20260918091000_background_import/migration.sql');
    assert.match(a, /ON DELETE RESTRICT/);
    assert.match(a, /purged_at.*IS NULL OR.*deleted_at/s);
    assert.match(b, /background_consent_required/);
    assert.doesNotMatch(a + b, /\b(?:DROP|TRUNCATE|DELETE FROM)\b/i);
});
test('source cleanup and worker CLIs use deployment workspace and never embed a credential', async () => {
    const worker = await read('tools/migrations/background-worker.ts'), cleanup = await read('tools/migrations/source-cleanup.ts');
    for (const s of [worker, cleanup]) {
        assert.match(s, /WORKSPACE_ID/);
        assert.match(s, /setPrismaLogSink/);
        assert.doesNotMatch(s, /console\.error\(error\)/);
    }
    assert.match(worker, /SIGTERM/);
    assert.match(cleanup, /expectedPlanHash/);
});
