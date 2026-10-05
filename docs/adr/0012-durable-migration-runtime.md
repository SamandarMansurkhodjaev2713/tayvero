# ADR-0012: Durable migration runtime persistence

## Status
Accepted for `MIG-PERSIST-002` deterministic checkpoint. Live PostgreSQL verification remains external.

## Context
The migration coordinator already had leases, retries, checkpoints and deterministic batch idempotency, but the persisted model did not retain enough worker state to make restart recovery trustworthy. A UI on top of that mismatch would have created false reliability.

## Decision
Use one tenant-scoped Prisma repository as the durable migration state boundary.

- Jobs and batches are updated through optimistic versions inside serializable transactions.
- Batch leases, attempts, imported/rejected counters and deterministic completion timestamps are persisted.
- Runtime events are append-only and JSON-sanitized before persistence.
- Batch identity and row-range fields are immutable after planning.
- Batch state transitions fail closed; completed batches must account for every planned row.
- Importer count-contract violations are non-retryable because retries cannot repair a deterministic contract bug.
- Job completion requires `acceptedRows + rejectedRows === totalRows`.
- Source filename input is a safe basename; source format and SHA-256 are validated before persistence.
- The same source hash may be imported more than once. File identity is not import intent, so `(workspace, source hash, entity type)` is indexed but not unique.

## Consequences
A process can restart and resume the same job without losing lease/counter/event state. Duplicate side effects are still prevented by deterministic per-batch operation identity, not by banning future imports of the same file.

## Non-claims
This ADR does not prove PostgreSQL locking, migration application, queue delivery, object storage, real importer side effects, rollback, UI/API or E2E. Those require separate gates.
