import { createHash } from 'node:crypto';
const DAY = 86400000;
const RETENTION_MS = 30 * DAY;
const ORPHAN_GRACE_MS = 7 * DAY;
const LIMIT = 25;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** No source referenced by ANY job is deleted, including terminal jobs. No receipt deletion. */
export function createSourceLifecycle({ db, store, context, authorize, tx, source, time, configured, fail }) {
    async function audit(client, c, id, type, details = {}) {
        await client.crmMigrationSourceEvent.create({ data: { workspaceId: c.tenantId, sourceId: id, actorId: c.actorId, type, details, createdAt: time() } });
    }
    async function lock(client, c, row) {
        const changed = await client.crmMigrationSource.updateMany({ where: { workspaceId: c.tenantId, id: row.id, version: row.version }, data: { version: { increment: 1 } } });
        if (changed.count !== 1)
            fail('SOURCE_CHANGED', 'Source changed concurrently');
        return { ...row, version: row.version + 1 };
    }
    async function referenced(client, c, id) {
        return await client.crmMigrationJob.count({ where: { workspaceId: c.tenantId, sourceId: id } }) > 0;
    }
    async function mark(c, id, expectedSha256, reason, cutoff = null) {
        return tx(c, async (client) => {
            let row = await source(client, c, id, true);
            if (row.sha256 !== expectedSha256)
                fail('SOURCE_CHANGED', 'Source digest changed');
            row = await lock(client, c, row);
            if (await referenced(client, c, id))
                fail('SOURCE_IN_USE', 'Recovery and audit require this referenced source');
            if (cutoff && !row.deletedAt && new Date(row.createdAt) > cutoff)
                fail('SOURCE_CHANGED', 'Source is too recent for retention');
            if (!row.deletedAt) {
                const at = time();
                await client.crmMigrationSource.updateMany({ where: { workspaceId: c.tenantId, id, version: row.version, deletedAt: null }, data: { deletedAt: at, deleteRequestedById: c.actorId, deleteReason: reason } });
                await audit(client, c, id, 'source.deletion.requested', { reason, sha256: row.sha256 });
                row = { ...row, deletedAt: at };
            }
            return row;
        });
    }
    async function purge(c, id, expectedSha256) {
        const row = await tx(c, async (client) => {
            const current = await source(client, c, id, true);
            if (!current.deletedAt || current.sha256 !== expectedSha256)
                fail('SOURCE_CHANGED', 'An exact durable deletion intent is required');
            if (await referenced(client, c, id))
                fail('SOURCE_IN_USE', 'A job still references this source');
            return current;
        });
        if (row.purgedAt)
            return { sourceId: id, deleted: true, purged: true };
        // Filesystem work is deliberately outside a transaction which can be retried.
        // Publication never resurrects a tombstone; prepare locks/rechecks the same source.
        await authorize(db, c);
        try {
            await store.remove({ context: c, sourceId: id, expectedSha256 });
        }
        catch (error) {
            await tx(c, client => audit(client, c, id, 'source.purge.failed', { code: ['SOURCE_KEY_UNAVAILABLE', 'SOURCE_INTEGRITY', 'UNSAFE_SOURCE_FILE'].includes(error?.code) ? error.code : 'SOURCE_IO_FAILED' }));
            throw error;
        }
        await tx(c, async (client) => {
            const current = await source(client, c, id, true);
            if (!current.deletedAt || current.sha256 !== expectedSha256 || await referenced(client, c, id))
                fail('SOURCE_CHANGED', 'Source deletion intent changed');
            const updated = await client.crmMigrationSource.updateMany({ where: { workspaceId: c.tenantId, id, deletedAt: { not: null }, purgedAt: null }, data: { purgedAt: time(), version: { increment: 1 } } });
            if (updated.count === 1)
                await audit(client, c, id, 'source.purge.completed', { sha256: expectedSha256 });
        });
        return { sourceId: id, deleted: true, purged: true };
    }
    async function inspect(c, cutoff) {
        const candidates = [], warnings = [];
        // Prefer recovery of durable deletion intents over newly aged sources.
        const pending = await db.crmMigrationSource.findMany({ where: { workspaceId: c.tenantId, deletedAt: { not: null }, purgedAt: null }, orderBy: { id: 'asc' }, take: LIMIT + 1 });
        const aged = await db.crmMigrationSource.findMany({ where: { workspaceId: c.tenantId, deletedAt: null, createdAt: { lte: cutoff } }, orderBy: { id: 'asc' }, take: 101 });
        let protectedCount = 0;
        for (const row of [...pending.slice(0, LIMIT), ...aged.slice(0, 100)]) {
            if (await referenced(db, c, row.id)) {
                protectedCount++;
                continue;
            }
            if (candidates.length < LIMIT)
                candidates.push({ sourceId: row.id, sha256: row.sha256, kind: row.deletedAt ? 'PENDING_PURGE' : 'UNUSED_EXPIRED' });
        }
        let inventory = { entries: [], truncated: false, scanned: 0, ignored: 0 };
        if (typeof store.inventory === 'function')
            inventory = await store.inventory({ context: c, maxEntries: 1000 });
        else
            warnings.push('SOURCE_INVENTORY_UNAVAILABLE');
        for (const item of inventory.entries) {
            if (candidates.length >= LIMIT)
                break;
            if (new Date(item.modifiedAt).getTime() > time().getTime() - ORPHAN_GRACE_MS)
                continue;
            const registered = await db.crmMigrationSource.findFirst({ where: { workspaceId: c.tenantId, id: item.sourceId } });
            if (registered)
                continue;
            try {
                const orphan = await store.get({ context: c, sourceId: item.sourceId });
                orphan.bytes.fill(0);
                if (new Date(orphan.createdAt).getTime() > time().getTime() - ORPHAN_GRACE_MS)
                    continue;
                if (await referenced(db, c, orphan.id)) {
                    protectedCount++;
                    continue;
                }
                candidates.push({ sourceId: orphan.id, sha256: orphan.sha256, kind: 'ORPHAN' });
            }
            catch {
                warnings.push('ORPHAN_NOT_AUTHENTICATED');
            }
        }
        candidates.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
        return { cutoff: cutoff.toISOString(), candidates, planHash: sha([c.tenantId, cutoff.toISOString(), candidates]), protectedCount,
            truncated: pending.length > LIMIT || aged.length > 100 || inventory.truncated || candidates.length === LIMIT,
            scannedFiles: inventory.scanned, ignoredFiles: inventory.ignored, warnings: [...new Set(warnings)], unusedRetentionDays: 30, orphanGraceDays: 7 };
    }
    async function registerOrphan(c, candidate) {
        const bytes = await store.get({ context: c, sourceId: candidate.sourceId, expectedSha256: candidate.sha256 });
        bytes.bytes.fill(0);
        if (new Date(bytes.createdAt).getTime() > time().getTime() - ORPHAN_GRACE_MS)
            fail('SOURCE_CHANGED', 'Orphan grace period has not elapsed');
        await tx(c, async (client) => {
            const existing = await client.crmMigrationSource.findFirst({ where: { workspaceId: c.tenantId, id: candidate.sourceId } });
            if (existing)
                fail('SOURCE_CHANGED', 'Source was registered after the cleanup preview');
            if (await referenced(client, c, candidate.sourceId))
                fail('SOURCE_IN_USE', 'Orphan still has a job reference');
            // Reserving the SAME unique source ID fences a late upload registration.
            // An old unacknowledged upload may fail, but can never publish a deleted file as active.
            await client.crmMigrationSource.create({ data: { id: bytes.id, workspaceId: c.tenantId, createdById: c.actorId, filename: bytes.filename, mimeType: bytes.mimeType,
                    sha256: bytes.sha256, byteLength: bytes.byteLength, format: 'UNKNOWN', createdAt: new Date(bytes.createdAt), deletedAt: time(), deleteRequestedById: c.actorId, deleteReason: 'ORPHAN', version: 1 } });
            await audit(client, c, bytes.id, 'source.orphan.tombstoned', { sha256: bytes.sha256 });
        });
    }
    return Object.freeze({
        lock,
        async remove(inputContext, { sourceId, expectedSha256 }) {
            const c = context(inputContext);
            await authorize(db, c);
            configured();
            await mark(c, sourceId, expectedSha256, 'MANUAL');
            return purge(c, sourceId, expectedSha256);
        },
        async cleanup(inputContext, { cutoff, apply = false, expectedPlanHash } = {}) {
            const c = context(inputContext);
            await authorize(db, c);
            configured();
            if (typeof apply !== "boolean")
                fail("INVALID_INPUT", "Cleanup mode must be explicit");
            const latest = time().getTime() - RETENTION_MS;
            const before = cutoff == null ? new Date(latest) : new Date(cutoff);
            if (!Number.isFinite(before.getTime()) || before.getTime() > latest || before.getTime() < 0)
                fail('INVALID_INPUT', 'Retention cutoff must be at least thirty days old');
            const preview = await inspect(c, before);
            if (!apply)
                return { ...preview, applied: false, results: [] };
            if (typeof expectedPlanHash !== 'string' || expectedPlanHash !== preview.planHash)
                fail('SOURCE_CHANGED', 'Review the current exact cleanup plan before applying it');
            const results = [];
            for (const candidate of preview.candidates) {
                try {
                    if (candidate.kind === 'ORPHAN')
                        await registerOrphan(c, candidate);
                    else
                        await mark(c, candidate.sourceId, candidate.sha256, 'RETENTION', before);
                    await purge(c, candidate.sourceId, candidate.sha256);
                    results.push({ sourceId: candidate.sourceId, status: 'PURGED' });
                }
                catch (error) {
                    if (error?.code === 'FORBIDDEN')
                        throw error;
                    results.push({ sourceId: candidate.sourceId, status: 'REVIEW_REQUIRED', code: ['SOURCE_IN_USE', 'SOURCE_CHANGED', 'SOURCE_KEY_UNAVAILABLE', 'SOURCE_INTEGRITY', 'UNSAFE_SOURCE_FILE'].includes(error?.code) ? error.code : 'SOURCE_IO_OR_AUDIT_FAILED' });
                }
            }
            return { ...preview, applied: true, results };
        },
    });
}
