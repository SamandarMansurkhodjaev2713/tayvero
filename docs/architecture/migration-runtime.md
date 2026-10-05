# Restart-safe migration runtime

The migration runtime now has two explicit layers:

1. deterministic coordination (`createMigrationCoordinator`);
2. tenant-scoped durable persistence (`createPrismaMigrationRepository`).

## Implemented and dependency-free verified

- explicit state machine;
- bounded batches and deterministic batch digests;
- stable per-batch idempotency identity;
- leases, expired-lease recovery and bounded retry;
- optimistic job and batch versions;
- serializable Prisma transaction policy with bounded P2034 retry;
- durable imported/rejected counters and append-only events;
- restart recovery against the same persisted repository state;
- dry-run entity/count/index validation;
- immutable batch planning fields and fail-closed batch transitions;
- deterministic importer accounting (`imported + rejected == batch count`);
- deterministic job completion accounting (`accepted + rejected == total`);
- safe source filename, format and SHA-256 validation;
- intentional reuse of the same source file is allowed; file identity is not import intent.

A crash after a provider/database side effect but before checkpoint persistence reuses the same batch operation identity. The real importer must therefore honor the supplied idempotency key.

## Still external / not claimed

- applying the Prisma migration to isolated PostgreSQL;
- real simultaneous-worker/locking and process-kill recovery;
- queue adapter and dead-letter policy;
- object-storage source retention;
- API/upload/UI workflow;
- real CRM entity importer and rollback/reconciliation execution;
- XLSX worksheet extraction.

AI may propose mappings, but deterministic validation remains authoritative.
