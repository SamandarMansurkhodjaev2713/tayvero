# CRM-PIPE-API-003 delivery

The configurable pipeline domain is connected to a signed-in, membership-verified NestJS/tRPC API and a functional workspace settings editor. Public input contracts cannot select a tenant. Owners/admins manage pipelines; members have read-only pipeline access. Mutations are idempotent and updates are optimistic.

The release also repairs the Prisma adapter so stored rows match the domain contract and adds real receipt/audit persistence. The legacy `Deal.stage` remains authoritative until the next expand/contract phase completes dual-write, backfill and reconciliation.

Verification is limited to dependency-free deterministic and static checks in this environment. PostgreSQL migration execution, full monorepo semantic typecheck/build and authenticated browser E2E are not represented as passed.

## Final hardening

The creation contract now carries the user's explicit default-pipeline intent end to end: settings editor → strict tRPC schema → canonical idempotency payload → pipeline definition → serializable repository transaction. The first pipeline remains obligatorily default. Creating a later pipeline with `isDefault=true` atomically demotes the previous default and increments its optimistic version. Regression tests cover requested-default, requested-non-default and first-pipeline behavior.
## Deterministic release gate

`bun run gate:pipeline-api` (or `node tools/release/run-pipeline-api-gate.mjs` when Bun is unavailable) records command-by-command evidence in `docs/quality/generated-pipeline-api-003-report.json` and `docs/quality/generated-pipeline-api-003-build.log`. The final available-environment run passed 80/80 targeted tests, 244/244 dependency-free regression tests, repository-wide ESM and TypeScript syntax sweeps, the strict governed-action boundary audit, manifest validation, repository/secret/BOM audit, Credential Vault configuration validation, the tenant-boundary ratchet and the prior governed-action migration verifier.

The gate remains explicit about unavailable or external checks: full dependency-backed workspace validation requires Bun and installed dependencies; PostgreSQL migration/locking/concurrency verification requires an isolated `TEST_DATABASE_URL`; authenticated transport/browser E2E requires a running staging deployment.
