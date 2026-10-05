> Historical diagnostic checkpoint. Superseded by `DELIVERY_AGENT_ACTION_REPAIR.md`; retained as failure evidence.

# Governed Agent Action Integration — autonomous checkpoint

## Release state

- Critical deterministic gate: **false**
- NEXT_SCOPE_ID: `AGENT-ACTION-INTEGRATION-002-REPAIR`
- Command status counts: `{"failed": 1, "not_available": 2, "passed": 9}`
- Static boundary audit findings requiring classification/migration: **2**

This checkpoint does not claim the complete product is production-ready. It records only evidence executed in this environment.

## Implemented in this batch

- One governed execution path for model-proposed actions.
- Runtime input and output validation.
- Server-owned tenant/actor/request context.
- Tenant-override and unsafe-object-key rejection.
- Permission, object-authorization and policy gates.
- Tenant/action/payload-bound single-use approvals.
- Receipt-based idempotency and concurrent-execution exclusion.
- Hashed database lease tokens and bounded stale-lease recovery contract.
- Quarantine of ambiguous mutating side effects instead of blind retry.
- Explicit timeout and cancellation.
- Executor propagation of operation digest and idempotency key.
- Redacted structured action audit events.
- Prisma-compatible durable receipt, approval and audit adapters.
- Additive Prisma models and migration.
- Application composition modules under `apps/agent`.
- Direct action-boundary audit and adversarial tests.

## Verification

- `Agent action runtime syntax` — **passed** (exit 0)
- `Prisma stores syntax` — **passed** (exit 0)
- `Agent action runtime adversarial tests` — **failed** (exit 1)
- `Durable store contract tests` — **passed** (exit 0)
- `Agent app governed composition syntax` — **passed** (exit 0)
- `Agent app Prisma composition syntax` — **passed** (exit 0)
- `Agent action boundary audit` — **passed** (exit 0)
- `All package.json manifests parse` — **passed** (exit 0)
- `Governed action Prisma schema/migration structure` — **passed** (exit 0)
- `No placeholders in governed action production modules` — **passed** (exit 0)
- `Bun availability` — **not_available**
- `Prisma CLI availability` — **not_available**

## Critical failures

- Agent action runtime adversarial tests

## Residual release gates

- Classify and migrate every confirmed direct legacy executor call site.
- Run the additive migration against an isolated PostgreSQL database.
- Prove receipt acquisition, approval consumption, stale-lease recovery and rollback under real concurrent transactions.
- Generate Prisma Client and run dependency-backed monorepo typecheck/build.
- Run staging agent execution E2E with real session/job/agent tenant contexts.
- Verify provider-side reconciliation for timeout and ambiguous-side-effect cases.
- Exercise kill switch, incident recovery and approval revocation in staging.

## Changed files

- `modified` `apps/agent/package.json`
- `added` `apps/agent/src/governed-action-execution.mjs`
- `added` `apps/agent/src/governed-action-prisma-composition.mjs`
- `added` `docs/adr/0006-governed-agent-action-execution.md`
- `added` `docs/adr/0007-durable-agent-action-state.md`
- `added` `docs/quality/generated-agent-action-boundary-audit.json`
- `added` `docs/quality/generated-agent-action-integration-build.log`
- `added` `docs/quality/generated-agent-action-integration-report.json`
- `added` `docs/runbooks/agent-action-incidents.md`
- `added` `docs/runbooks/governed-action-receipt-recovery.md`
- `modified` `package.json`
- `added` `packages/agent-action-runtime/package.json`
- `added` `packages/agent-action-runtime/src/index.mjs`
- `added` `packages/agent-action-runtime/src/prisma-stores.mjs`
- `added` `packages/agent-action-runtime/test/governed-action-runtime.test.mjs`
- `added` `packages/agent-action-runtime/test/prisma-stores.test.mjs`
- `added` `packages/db/prisma/migrations/20260831190000_governed_action_execution/migration.sql`
- `modified` `packages/db/prisma/schema.prisma`
- `modified` `progress.md`
- `modified` `qa.md`
- `added` `tools/quality/audit-agent-action-boundaries.mjs`
