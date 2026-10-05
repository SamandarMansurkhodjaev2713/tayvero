# Configurable pipeline API rollout

1. Use an isolated PostgreSQL database whose name ends in `_test`.
2. Apply all existing migrations, then `20260901150000_pipeline_api_runtime`.
3. Run Prisma generation.
4. Run the pipeline API targeted suite and full workspace typecheck/build.
5. Create two organizations and memberships in staging.
6. Verify that a session for organization A cannot list, read or mutate organization B pipelines.
7. Run concurrent create/update/default commands with identical and conflicting idempotency keys.
8. Verify receipt and audit rows and request IDs.
9. Reorder and rename stages to exercise unique-key swaps.
10. Confirm a stage with an assignment cannot be removed.
11. Roll out the settings UI before enabling any deal dual-write/read cutover.

Rollback is application-only: the additive tables may remain. Do not drop the legacy `Deal.stage` column in this release.
