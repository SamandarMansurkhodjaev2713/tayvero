
# Migration Center core

## Implemented in R8

- bounded RFC4180 CSV/TSV parser;
- BOM and delimiter handling;
- duplicate/empty header rejection;
- exact column-count validation;
- deterministic field mapping;
- email, Uzbekistan phone, date, boolean and exact money normalization;
- formula-injection protection for generated CSV reports;
- file name, MIME and XLSX ZIP-signature boundary checks;
- deterministic dry-run;
- intra-file and existing-record duplicate signals;
- bounded batches;
- stable idempotency and reconciliation digests;
- additive job, batch, issue and runtime-event persistence schema;
- serializable Prisma repository with optimistic job/batch versions;
- durable leases, attempts, counters, completion timestamps and append-only events;
- restart-safe coordinator recovery against persisted state.

## Not yet claimed

- XLSX worksheet extraction;
- uploaded object-storage boundary;
- API and UI workflow;
- live PostgreSQL application/concurrency proof;
- queue/process-kill execution proof;
- rollback/replay implementation;
- direct CRM connectors.

AI may propose a mapping, but deterministic validation remains authoritative.
