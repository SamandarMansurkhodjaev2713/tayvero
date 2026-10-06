# Team tasks: backend review, 2026-10-06

Backend scope: `packages/db` and `apps/api`. No publication, production database reset, provider calls, auth bypass, or governed/default-OFF changes were performed by this lane.

## Verified results

- Production signed-cookie HTTP tests: **24/24 passed**, **106 assertions**, zero failures/skips. The new team-task suite contributes 12 cases; the existing authenticated-workspace suite contributes 12.
- Actual assignment migration SQL executed against legacy rows in a unique transactional PostgreSQL schema: **1/1 passed**, **4 assertions**. The transaction rolls back its temporary schema.
- All **67 migrations** applied to a distinct guarded `*_test` database in the disposable PostgreSQL 16 container. Read-only Prisma migration diff against the final schema: exit 0, empty migration. No diagnostic SQL was executed against application tables.
- `apps/api` and `packages/db` semantic type checks: exit 0. Final Biome checked 10 owned/affected source/test files with zero errors and no fixes needed.
- Final fresh acceptance database readback after both HTTP suites: 0 activities, 0 task audit events, 0 users, 0 companies, 0 fault-injection functions and 0 temporary migration schemas. Scoped audit cleanup was also added to the existing HTTP suite because retained audit rows intentionally have no cascading foreign key.

## Critical review and refinement

1. **Ownership and membership.** `createdById` remains the author. Omitted TASK assignee defaults to the active actor; explicit null means unassigned. Existing TASK rows backfill only active owner/admin/member authors in the installation workspace. Revoked, foreign-workspace and unknown recipients are rejected without writes. Future direct legacy inserts remain unassigned; there is no hidden trigger or creator fallback in the personal queue.
2. **Authorization.** Every task mutation verifies current workspace membership inside its transaction. Author, current assignee and owner/admin can edit deadlines and completion; only author or owner/admin can change responsibility. An unrelated member cannot mutate a guessed ID. Authenticated revoked sessions remain denied. Non-TASK entries expose null task capabilities.
3. **Concurrency and causality.** Task rows are locked before changes; expected versions prevent stale writes. Competing assignments and competing deadline/completion writes produce one success and one conflict, with the accepted fields preserved. Repeated completion preserves its timestamp, version and audit count. History orders by taskVersion before timestamps because transaction-start timestamps can differ from commit order. Legacy completion without expectedVersion remains supported; the new UI supplies a version.
4. **Atomicity and linked CRM data.** Task, audit and activity stamps commit together. Real scoped SQL triggers inject audit and stamp errors; readback proves no task/audit residue or version/date change. Contradictory company/contact/deal anchors are rejected before writes; matching anchors are accepted. Stamps use the same transaction client and execute sequentially on its single PostgreSQL connection.
5. **Queue correctness.** Personal queues use actual assignee; team queues retain unassigned tasks and support explicit author/recipient filters. Counts and rows share one repeatable-read snapshot and one cutoff. Stable ID tie-breaking delivers all 106 equally dated/undated fixture rows once across pages. Filters precede the limit. Dashboard personal overdue tasks use assignee; team overdue tasks use the team scope. Offset pagination is verified on a stable dataset; this is not a claim of cursor stability during concurrent inserts.
6. **Dates, history and lifecycle.** Create/update accept explicit ISO timestamps with Z/offset, reject date-only and offset-free dates, preserve omitted deadlines and clear explicit null. Audit stores member IDs and name snapshots, without task bodies or emails. Name snapshots survive rename/departure; old JSON without assigneeName reads as null. Actual current membership supplies assigneeActive, rather than inferring revocation from a bounded picker. Audit records intentionally retain stable IDs without user/task cascading foreign keys.
7. **Isolation and evidence.** Fixtures use real production auth with unique seats/records. Cleanup is scoped to owned fixture actors/records, aggregates errors and restores bridge configuration even if app shutdown fails. SQL fault triggers are scoped by owned actor/company IDs and removed in finally; their functions are removed even if trigger removal errors. Database work is enabled only after NODE_ENV=test and the existing test-database guard succeeds. Temporary legacy schema changes are enclosed by BEGIN/ROLLBACK. The container is retained for the parent's final checks.

## Initial failures preserved

- First HTTP invocation incorrectly used the same database identity for DATABASE_URL and TEST_DATABASE_URL. The existing guard rejected it before fixture writes; the guard was not weakened. The next invocation used distinct bootstrap/test identities.
- First HTTP fixture used a nonexistent company.createdById field. Prisma rejected setup; the fixture was corrected to the actual company.ownerId model.
- First minimal legacy-schema migration fixture omitted the completedAt/dueAt columns referenced by the new index. PostgreSQL rejected the SQL and the transaction rolled back. Adding those actual preexisting columns made the migration fixture valid. These are fixture construction failures, not hidden passing product results.

## Commands and local evidence

All test commands used child-only NODE_ENV=test, telemetry disabled, explicit distinct loopback bootstrap/test URLs, and an ephemeral auth secret. No cookie/session token is printed. Parent will redact/copy scratch evidence before publication.

| Verification | Command | Scratch evidence |
| --- | --- | --- |
| Guarded prepare | `bun run --cwd packages/db db:test` | `.scratch/team-backend-prepare-final.log` |
| Router codegen | `bun run --cwd apps/api trpc:generate` | `.scratch/team-backend-router.log` |
| Team + existing HTTP | API cwd: `bun test --preload ./test/setup.ts ./test/team-tasks.e2e.spec.ts ./test/authenticated-workspace.e2e.spec.ts` | `.scratch/team-backend-http-final.log` |
| Legacy migration | `bun test --cwd packages/db ./test/team-task-migration.spec.ts` | `.scratch/team-backend-migration.log` |
| Schema diff | DB cwd: `bunx --bun prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code` | `.scratch/team-backend-schema-diff.log` |
| API semantic | `bun run --cwd apps/api check-types` | `.scratch/team-backend-types-final.log` |
| DB semantic | DB cwd: `bun run check-types` | `.scratch/team-backend-db-types.log` |
| Owned source check | `biome check` on activities, stamp, dashboard service, existing HTTP fixture and the two new tests | `.scratch/team-backend-biome.log` |
| Scoped fixture cleanup | read-only PostgreSQL count query | `.scratch/team-backend-cleanup.log` |

This verifies the bounded backend business lifecycle with real local PostgreSQL and HTTP auth. Full repository Linux CI, browser behavior, staging/native execution, provider delivery and production readiness require the parent's separate acceptance results. The parent independently owns governed-agent assignment tests and evidence.
