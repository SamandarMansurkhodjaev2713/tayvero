# Delivery: AGENT-ACTION-INTEGRATION-002-REPAIR

## Scope

This batch repairs the failed governed-action adversarial gate and removes the parallel action-registry execution path. It does not claim migration of the two remaining legacy `AGENT_ACTION_EXECUTORS` consumers.

## Root causes

1. The test/application executor adapter destructured only `input`, `context`, `signal` and `attempt`, dropping `idempotencyKey` and `operationDigest`.
2. `@crm/action-registry` duplicated execution, approval, lease, idempotency and audit responsibilities already owned by `@crm/agent-action-runtime`.
3. The agent application composition could create an incomplete fallback registry rather than fail fast.
4. Node 22 custom DNS lookup uses `{ all: true }` during connection setup; the pinned HTTP lookup returned a scalar callback shape, causing `ERR_INVALID_IP_ADDRESS` in the R11 integration regression suite.
5. The repository audit still encountered stale first-party identity data in tests and historical generated reports.

## Implemented

- Propagated provider idempotency key and operation digest without adapter loss.
- Converted the action registry to an immutable catalog-only component.
- Removed legacy registry approval/state modules and execution-state options.
- Required explicit governed-runtime dependencies in application composition.
- Added strict proposal and execution-option validation.
- Added pre-side-effect cancellation checks so an already-aborted request cannot acquire a receipt or consume approval.
- Strengthened manifest, retry, permission, schema and immutable-input validation.
- Added durable Prisma receipt, approval and redacted-audit adapters.
- Added a boundary audit with an error gate and a separate strict legacy-migration gate.
- Repaired Node 22 address-pinned HTTP lookup handling and added a total request deadline.
- Removed remaining stale first-party identity values found by the repository audit.
- Added an explicit release verifier and reproducible root scripts.

## Verification classification

`AGENT-ACTION-INTEGRATION-002-REPAIR` may be marked `IMPLEMENTED / INTEGRATION_VERIFIED` only when all batch-critical Node suites, static boundaries, manifest checks, repository audit and release verifier pass in the generated report.

Not included in this verification level:

- isolated PostgreSQL migration and multi-worker concurrency execution;
- live external provider reconciliation after ambiguous outcomes;
- staging authentication/tenant transport E2E;
- migration of the two legacy runtime dispatch call sites;
- Bun-backed full monorepo lint, typecheck, test and build when Bun/dependencies are unavailable.

## Next scope

`AGENT-ACTION-INTEGRATION-004-LEGACY-CALLSITE-MIGRATION`

## Final regression hardening

The repository-wide dependency-free regression gate exposed two unrelated but release-relevant defects after the targeted action tests became green:

1. `@crm/pipeline-runtime` leaked `PipelineDomainError` from pipeline-core instead of preserving its public `PipelineRuntimeError` contract. The runtime now applies one explicit error boundary to every public operation, and regression tests cover both stale optimistic transitions and invalid pipeline definitions.
2. Four executable `.mjs` tools had a blank line before their shebang. The shebangs now begin at byte offset zero, and every repository `.mjs` file is syntax-checked as part of the release evidence.

These fixes were made before packaging rather than suppressing or excluding the failing regression.


## Final adversarial hardening

Before release packaging the repaired path received an additional hostile-input pass:

- governed inputs and validator outputs are restricted to plain JSON-compatible data;
- custom `toJSON` hooks and class instances cannot run inside cloning or operation hashing;
- tenant override checks run both before and after action-specific validation;
- cyclic arrays, unsafe keys and unsupported values fail closed;
- JSON-schema required fields use own-property semantics;
- malformed policy approval metadata and correlation identifiers are rejected;
- audit redaction writes unsafe-looking keys without prototype mutation.

These cases are covered by deterministic regression tests and are included in the generated repair gate report.
