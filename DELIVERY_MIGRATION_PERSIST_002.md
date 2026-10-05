# DELIVERY — MIG-PERSIST-002

## Scope
Close the runtime/storage contract gap for restart-safe CRM migrations without adding UI or pretending that fake/in-memory verification is a live database proof.

## Implemented
- Prisma-backed migration repository with serializable transaction retry policy.
- Durable job, batch lease, attempt, counter, optimistic version and append-only event persistence.
- Restart/recovery proof by recreating the coordinator against the same persisted repository state.
- Strict dry-run plan validation: tenant, entity, row totals, contiguous batch indexes and batch digests.
- Strict importer outcome reconciliation and immediate terminal failure on deterministic count-contract violations.
- Repository-owned batch transition/invariant validation.
- Deterministic `completedAt` timestamps from the coordinator clock.
- JSON-safe event details.
- Safe source filename/format/digest validation.
- Removal of the incorrect unique source-hash constraint so the same file can be intentionally retried/re-mapped.

## Safety
No customer CRM rows are rewritten by this scope. The database migration adds runtime durability fields/events and relaxes one migration-job uniqueness rule into a normal index.

## Verification boundary
Dependency-free tests and structural/repository gates are release-critical. Isolated PostgreSQL migration/concurrency/restart tests, queue/process-kill drills, object storage and browser/API E2E remain external.

## Product-wide next scope
`CRM-PIPE-POSTGRES-005` remains the primary next scope. The migration track can continue with `MIG-API-002` after this checkpoint.
