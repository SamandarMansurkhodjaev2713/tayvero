/** Dedicated-workspace worker; run under a process supervisor only after DB/staging acceptance. */
import { db, setPrismaLogSink } from '@crm/db/client';
import { WORKSPACE_ID } from '@crm/db/workspace';
import { createMigrationApplicationFromEnvironment } from '../../apps/api/src/migrations/migration-application.mjs';
import { runBackgroundLoop } from './background-loop.mjs';
const args = process.argv.slice(2);
if (args.length !== 1 || !['--once', '--loop'].includes(args[0] ?? ''))
    throw new Error('Usage: bun tools/migrations/background-worker.ts --once|--loop');
// Prisma error messages may contain query values: do not forward raw driver events to worker logs.
setPrismaLogSink(({ level }) => { if (level === 'error')
    console.error('MIGRATION_WORKER_DATABASE_ERROR'); });
const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
try {
    const application = await createMigrationApplicationFromEnvironment({ db, workspaceId: WORKSPACE_ID });
    await runBackgroundLoop({ runOnce: application.runBackgroundOnce, signal: stop.signal, once: args[0] === '--once',
        onTick: result => console.log(JSON.stringify({ type: 'migration.worker.tick', ...result })),
        onError: error => console.error(JSON.stringify(error)),
    });
}
catch {
    console.error('MIGRATION_WORKER_STOPPED: check flags, migrations, volume, keys and redacted server telemetry');
    process.exitCode = 1;
}
finally {
    await db.$disconnect();
}
