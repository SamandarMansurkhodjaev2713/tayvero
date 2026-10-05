# ADR-0011: Legacy DealStage dual-write bridge

## Decision

Keep `Deal.stage` authoritative while introducing an explicit persisted mapping from every legacy `DealStage` value to a stage in the active default configurable pipeline. When strict dual-write is enabled, legacy deal creation and stage transitions update the sidecar assignment inside the same Prisma transaction.

## Why explicit mapping

A custom pipeline may have fewer, more or differently named stages than the seven legacy enum values. Inferring mappings from names would make migration correctness depend on labels. The mapping is therefore explicit and validated by semantics.

## Invariants

- all seven legacy stages must be mapped;
- mappings target one active default pipeline for the workspace;
- open legacy stages can only map to `OPEN` stages;
- `CLOSED_WON` maps only to `WON`;
- `CLOSED_LOST` and `UNQUALIFIED_TO_BUY` map only to `LOST`;
- strict dual-write is fail-closed and atomic with the legacy mutation;
- assignment updates use optimistic versions;
- default-pipeline handoff is blocked while strict bridge mode is active unless the target is already the mapped pipeline;
- legacy reads remain authoritative until reconciliation is zero through an observation window;
- no destructive legacy schema change is part of this ADR.

## Rejected alternatives

### Infer by stage key/name

Rejected because customer-defined labels and stage counts are not stable migration identifiers.

### Best-effort dual-write

Rejected because accepting a legacy write after a sidecar failure creates silent divergence that makes later read cutover unsafe.

### Immediately switch reads to configurable assignments

Rejected because the current environment has not run PostgreSQL backfill/concurrency/staging gates.

### Remove DealStage now

Rejected because it destroys rollback before the new representation has production evidence.
