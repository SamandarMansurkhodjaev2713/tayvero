# ADR-0008: Keep the action registry catalog-only

## Status

Accepted for `AGENT-ACTION-INTEGRATION-002-REPAIR`.

## Context

The project contained two overlapping execution mechanisms:

1. an action registry that could own approvals, leases, idempotency and direct execution;
2. the newer governed action runtime that independently enforced validation, authorization, policy, approval, receipts and audit.

Two policy engines create an unsafe split-brain condition. A caller can accidentally choose the weaker path, fixes must be duplicated, and audit/idempotency semantics can diverge.

The failed adversarial test also showed that the application/test composition could drop the provider idempotency key and operation digest before invoking an executor.

## Decision

`@crm/action-registry` is reduced to immutable action catalog responsibilities:

- validate and register manifests;
- snapshot schema and metadata;
- resolve an action entry;
- expose stable catalog listing.

It must not expose `execute`, approval issuance/verification, receipt state, clocks or leases.

All execution flows through `@crm/agent-action-runtime`, composed by `apps/agent/src/governed-action-execution.mjs`. The application must provide an explicit catalog, authorizer, policy evaluator, receipt store and audit sink. No fallback registry is created.

The executor contract explicitly propagates the provider idempotency key and operation digest. A static boundary audit rejects direct catalog execution, removed registry-state APIs and direct executor calls outside the governed runtime.

## Alternatives considered

### Keep both execution mechanisms

Rejected. It preserves a policy-bypass path and doubles security-critical behavior.

### Move all governance into the registry

Rejected. Registry/catalog responsibilities would remain coupled to persistence and execution, making reuse, testing and application composition harder.

### Permit direct executors for trusted callers

Rejected. “Trusted caller” is difficult to preserve over time and bypasses a consistent audit, approval and idempotency boundary.

## Consequences

Positive:

- one enforceable action-execution path;
- consistent tenant, permission, approval and receipt semantics;
- easier adversarial testing;
- no silent in-memory production fallback;
- static detection of newly introduced bypasses.

Costs:

- legacy dispatch call sites must be migrated;
- action manifests must satisfy stricter registration requirements;
- production composition must supply durable stores explicitly.

## Verification

The decision is covered by catalog tests, governed runtime adversarial tests, application-composition tests, Prisma store contract tests and the action-boundary static audit. PostgreSQL multi-worker and staging end-to-end verification remain separate release gates.
