# Deal stage expand/contract runbook

## Phase A — expand and map

1. Apply only additive pipeline/bridge migrations.
2. Validate constraints and indexes in an isolated PostgreSQL database.
3. Create/select the active default pipeline.
4. Prepare an explicit mapping for every legacy enum value using `tools/migrations/deal-stage-mapping.example.json`.
5. Run a dry-run:
   `bun tools/migrations/deal-stage-bridge.ts --mapping ./mapping.json`
6. Any unmapped value, semantic type mismatch, missing target or non-default target stops rollout.

## Phase B — backfill and reconcile

7. Apply mapping and bounded backfill:
   `bun tools/migrations/deal-stage-bridge.ts --mapping ./mapping.json --apply --batch-size 250`
8. The command leaves `Deal.stage` untouched and seeds/repairs only sidecar assignments.
9. Reconciliation must report `mismatched: 0` before dual-write is enabled.
10. Preserve the reconciliation digest as release evidence.

## Phase C — strict dual-write

11. Set `CRM_PIPELINE_DUAL_WRITE_MODE=strict` only after zero mismatch.
12. New deal creation and legacy stage changes update sidecar assignments in the same transaction.
13. A missing/invalid mapping or lost assignment concurrency race rolls the legacy mutation back.
14. Re-run reconciliation during the observation window.
15. Do not switch the default pipeline while strict mode is active. To migrate defaults: disable strict mode, change default, remap/backfill/reconcile, then re-enable strict mode.

## Phase D — shadow read and cutover

16. Keep legacy `Deal.stage` authoritative through this checkpoint.
17. Add shadow-read comparison in the next environment-backed scope.
18. Switch deal reads only after mismatch rate remains zero for the agreed observation window.
19. Continue legacy writes during the rollback window.
20. Remove the legacy enum only in a later explicitly approved deployment.

## Rollback

Set `CRM_PIPELINE_DUAL_WRITE_MODE=off`. Do not delete mapping/assignment evidence. Never combine destructive legacy removal with initial backfill, first dual-write activation or first read cutover.
