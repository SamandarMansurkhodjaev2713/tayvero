# CRM-PIPE-DUAL-WRITE-004 delivery

## Scope

This checkpoint implements the safe expand-phase bridge between legacy `Deal.stage` and configurable pipeline assignments. It does **not** switch deal reads to the sidecar and does not remove or rewrite the legacy enum.

Implemented:

- explicit persisted `DealStage -> pipeline stage` mappings;
- validation that all seven legacy stages are mapped;
- semantic guardrails (`OPEN -> OPEN`, `CLOSED_WON -> WON`, losing legacy stages -> `LOST`);
- opt-in strict transactional dual-write for deal create and stage changes;
- idempotent self-healing when the requested legacy stage is unchanged but the sidecar assignment is missing/drifted;
- optimistic assignment updates;
- fail-closed behavior when mapping, target pipeline or target stage is invalid;
- strict-mode guard against switching the default pipeline before remapping;
- bounded operational mapping/backfill/reconciliation command, dry-run by default;
- deterministic reconciliation digest and mismatch classes;
- additive-only database migration;
- release tests and a dedicated checkpoint gate.

## Rollout contract

`CRM_PIPELINE_DUAL_WRITE_MODE=off` remains the default.

Required order:

1. Apply the additive migration in an isolated PostgreSQL environment.
2. Select the active default pipeline.
3. Prepare an explicit mapping JSON for all seven legacy stages.
4. Run `bun tools/migrations/deal-stage-bridge.ts --mapping <file>` as a dry-run.
5. Run the same command with `--apply` to persist mapping and backfill assignments.
6. Reconciliation must report exactly zero mismatches.
7. Enable `CRM_PIPELINE_DUAL_WRITE_MODE=strict` in a controlled environment.
8. Observe dual-write and perform repeated reconciliation.
9. Keep all deal reads on legacy `Deal.stage` during this checkpoint.
10. Read cutover is a later deployment after an agreed zero-mismatch observation window.

The command never mutates legacy `Deal.stage`.

## Rollback

Rollback is application-only:

- set `CRM_PIPELINE_DUAL_WRITE_MODE=off`;
- legacy reads and writes continue to work as before;
- retain sidecar mapping and assignment rows for diagnosis/reconciliation;
- do not drop pipeline tables, mappings or legacy enum/column during the rollback window.

## Known boundary

The existing CRM remains a single-workspace product in this checkpoint (`WORKSPACE_ID="workspace"`). Configurable pipeline sidecars are workspace-scoped, but legacy Company/Contact/Deal ownership has not yet been migrated to a true tenant-owned global SaaS model. This checkpoint does not claim that SEC-001 is complete.

## Verification status

Dependency-free deterministic tests verify the mapping compiler, reconciliation engine, bridge planning, transactional call boundaries, strict-mode default-pipeline guard and additive migration contract.

External gates still required:

- real Prisma generation after the schema change;
- isolated PostgreSQL migration execution;
- real backfill and reconciliation on representative data;
- simultaneous-writer/concurrency tests;
- dependency-backed Bun formatter/lint/typecheck/test/build;
- authenticated staging API/browser E2E.

Therefore this checkpoint is not a production cutover claim.

## Final deterministic gate evidence

The completed checkpoint gate reports `VERIFIED_CHECKPOINT` with **96/96 targeted tests** and **262/262 dependency-free regression tests** passing, with no critical deterministic failures. A separate `CRM-PIPE-POSTGRES-005` harness is now present for the remaining real-database gate; in the current environment that harness correctly reports `BLOCKED_EXTERNAL` rather than fabricating a pass.
