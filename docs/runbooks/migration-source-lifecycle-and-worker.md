# Migration source lifecycle and background worker

Scope: MIG-SOURCE-LIFECYCLE-001 / MIG-BACKGROUND-WORKER-001. Updated 18 September 2026 (Tashkent).
Status: implemented with local evidence; REAL PostgreSQL, Bun/Prisma, authenticated UI and process deployment
acceptance still required. Nothing in this runbook has been deployed to a customer environment.

## 1. Prerequisites and safe rollout

Use an isolated disposable TEST_DATABASE_URL for acceptance. Never point verification at a customer DB and
never substitute DATABASE_URL for TEST_DATABASE_URL. Required commands from repository root:

```sh
bun install --frozen-lockfile
bun run gate:pipeline-postgres
bun run gate:operations-postgres
bun run quality:gate
```

The operations gate includes four new source/worker PostgreSQL cases; the dependency-free runner excludes
them. If generation, SQL, types or integration fail, fix implementation rather than relaxing the assertions.
The written expansion migrations are:

- 20260918090000_migration_source_lifecycle
- 20260918091000_background_import

They were NOT applied in the authoring environment. SQL adds fields/constraints/index and a source-event table;
there is no DROP, source-data rewrite or legacy Deal.stage read cutover. Apply through the normal migration
workflow only after disposable DB acceptance and a rehearsed backup/restore plan.

For staging, API and worker need the SAME dedicated workspace, database, persistent POSIX source volume and
keyring, and the same trusted service UID. Separate local disks on multiple hosts are NOT a shared store.
The volume must support the existing exclusive publication, O_NOFOLLOW, hard links and directory fsync.
Filesystem durability under actual storage failures still needs qualification. Avoid ephemeral/serverless disks.

Supply secrets through the deployment secret manager, never chat, source control or command-line arguments:

```env
MIGRATION_CENTER_ENABLED=0
MIGRATION_EXECUTION_ENABLED=0
MIGRATION_BACKGROUND_ENABLED=0
MIGRATION_SOURCE_ROOT=
MIGRATION_SOURCE_KEYS_JSON=
MIGRATION_SOURCE_ACTIVE_KEY=
```

The committed values remain OFF/empty. On staging, enable Center and writes only after acceptance; enable
background separately on BOTH API and worker. The keyring is a JSON map of key IDs to base64 32-byte keys;
retain every historical key needed by stored sources. Do not use examples as live keys.

## 2. Explicit background consent

Open /<slug>/settings/migrations, preview the source, review mapping and prepare a specific job. A current
owner/admin explicitly enables background for that job. READY alone never means background consent.
The worker records and rechecks that admin; removing their rights stops scheduling. Changing who resumes
must be explicit. The original job creator remains the record owner and must remain a member.

Launch the executable only after staging acceptance:

```sh
bun run migration:worker --once
# Or run under a service/process supervisor:
bun run migration:worker --loop
```

No credentials or impersonation IDs are exposed on a public worker route. The CLI uses WORKSPACE_ID from the
same dedicated-workspace package as the application. It does not provision tenancy or deploy a daemon itself.
One tick examines up to 5 due jobs (internal configurable bound 1..10). Each advances at most one existing
50-row batch. Serial loop default poll is 2 seconds; due jobs use guarded queue versions and a 180-second
claim. Existing batch lease and row receipt invariants are preserved.

SIGTERM/SIGINT drain the currently executing work and stop before the next job. Give the supervisor enough
shutdown grace for DB/IO latency. A forced kill can leave a queue lease until expiry; it must not require deleting
receipts or making a new job. Unexpected top-level failures stop after five loop failures; supervision and
alerting must avoid an uncontrolled restart loop. Logs emit safe operational IDs/codes, not raw SQL/DSNs/source
values. IDs are still operational information and require restricted log access.

Pause clears scheduling. A packet already claimed may still commit. Stop/cancel is a separate irreversible job
state; use it when no further packets are desired, then wait for leases before rollback. A stale completion cannot
re-enable a paused/newly configured job. Manual executeNext is blocked while background scheduling is enabled.
If the worker is not actually running or lacks the shared volume/keys, enabling consent alone does not execute
anything. UI says scheduled, not online/healthy. No heartbeat, throughput or SLA claim is made.

## 3. Source cleanup

Cleanup preserves ALL sources referenced by a job, including completed/cancelled/failed jobs. It does not remove
row receipts, plans, history or CRM records. In particular the 20-active-source quota can remain full of protected
sources; this patch is not a terminal-history retention policy or a quota workaround.

Rules: unreferenced registered source older than 30 days; unregistered authenticated published .source file older
than 7 days by both mtime and encrypted createdAt. Existing pending deletion intents may be completed. The UI
renders a preview then asks for confirmation of that exact plan. Explicit manual deletion is also limited to an
unreferenced source and exact digest. DeletedAt means requested, purgedAt means physical deletion acknowledged.

CLI preview (replace placeholder with an existing authorized administrator ID, not a secret):

```sh
bun run migration:source-cleanup --actor CURRENT_ADMIN_ID
```

Inspect candidates, warnings, protectedCount, truncated and the cutoff/planHash. Applying requires the exact
reviewed values, not a fabricated or stale hash:

```sh
bun run migration:source-cleanup --actor CURRENT_ADMIN_ID --cutoff REVIEWED_ISO_TIME --apply --plan REVIEWED_SHA256
```

This is a privileged server-side operator command, not an HTTP impersonation feature. API requests derive actor
from the current session. Both paths use the same authorization and source-reference guards. Fresh inspection,
tombstone persistence and authorization are repeated before removal. Filesystem deletion is outside retried SQL;
final acknowledgement is a separate idempotent audited update. A pending tombstone can be retried after a crash.

Boundaries: at most 25 cleanup candidates, first 100 aged registered sources, bounded 1000-entry directory scan.
A truncated/protected/ignored result is NOT a claim that the whole directory was covered. Re-running may still
not reach every entry in a large directory; exhaustive inventory pagination is unfinished. Temporary .upload files,
corrupt sources, missing keys, unknown names, links and unsafe modes are not automatically destroyed. They need
manual restricted review. Do not add broad rm -rf/find-delete workarounds.

ORPHAN deletion first registers the same opaque ID as a tombstone; a delayed upload cannot publish a live record
for deleted bytes. An old unacknowledged upload can fail safely and be uploaded again with a new identity.
Persistent audit does not mean immutable/WORM storage. Recovery from whole-database/storage loss requires backups.

## 4. Required acceptance matrix

1. Concurrent source prepare/delete: exactly one wins; no prepared job references a deleted source.
2. Two purge requests: one physical result and one completed audit event; test loss of acknowledgement.
3. Pending tombstone across process restart; reject corrupt/missing-key/unsafe/FIFO source.
4. Protected terminal and active import sources survive cleanup; quota and truncated inventory are honest.
5. Start a 123-row job; close browser; worker completes in batches and CSV report reconciles.
6. Two real worker processes/DB connections, forced kill after CRM commit and before coordinator acknowledgement.
7. Wait for lease expiry and restart with unchanged keys/volume; no duplicated row IDs or new job identity.
8. Revoke requesting admin; remove original owner; stop rather than impersonate another user.
9. Pause during source read versus during a claimed batch; only the latter may finish. Cancel and rollback.
10. API behind the real proxy, session expiry, member denial, all palettes/modes, 390/768/1440 widths,
    keyboard/dialogs/loading/error states and RU/UZ/EN labels. New React/browser checks are NOT executed here.
11. Coordinated restore of DB, source files and historical keys; no lost mapping/receipts after backup restore.
12. Local filesystem changes never establish NFS/object-storage power-loss behavior or production throughput.

## 5. Rollback and remaining work

Disable background on API, pause jobs, drain/stop the worker supervisor, then disable new feature flags as needed.
Keep expansion tables, tombstones, events, row receipts, persistent volume and keyring. Do not drop source audit
or reset job versions to make a red test pass. Old read authority for Deal.stage is unchanged.

Not implemented here: referenced-source expiry/archival policy, temp-file janitor, exhaustive inventory pagination,
object-storage adapter, configurable retention UX, distributed worker heartbeat/alerts, XLSX/deals/associations/
merge, full onboarding/channels, shared tenancy, guided ambiguous action reconciliation. External availability is
not the only remaining work.

Engineering references (contract context, not evidence of a passing runtime):
- https://nodejs.org/docs/latest-v22.x/api/fs.html
- https://www.postgresql.org/docs/17/explicit-locking.html
