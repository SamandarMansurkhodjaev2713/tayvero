# Update 2026-09-18 — source lifecycle and opt-in background imports

Authoritative baseline: tayvero-master-2026-09-15.zip,
SHA-256 6f24d40c4077a92f6622ad8c8870944ec864ab64437acdd49bb353a9a4b02fcf.
MIG-SOURCE-LIFECYCLE-001 / MIG-BACKGROUND-WORKER-001 implemented with local runtime evidence;
real PostgreSQL, Bun/Prisma/types/build and authenticated UI/worker-process acceptance remain unverified.
New behavior: durable deletion intent/purge acknowledgement/audit, protected job sources, bounded orphan cleanup;
explicit background consent + same coordinator/receipts, queue lease/fencing, authority recheck, drain-on-pause.
571/571 local tests and 15/15 local gates; 4 new real PostgreSQL tests written, NOT executed.
Two additive SQL migrations written, NOT applied; no real DB writes. Default flags OFF; legacy Deal.stage
still authoritative; 15 old tenant findings, 0 new. See ADR0016 and source lifecycle/worker runbook.
Primary NEXT_SCOPE_ID remains CRM-PIPE-POSTGRES-005; parallel MIG-APPROVAL-POSTGRES-001.
Independent follow-up: AGENT-CONTINUATION-RECONCILIATION-001; source pagination and referenced-history retention
remain tracked code work, not mere missing credentials. Historical entries below are not current completion claims.

---

# Update 2026-09-15 — continuation and export
Source: tayvero-master-2026-09-14.zip, SHA 9ce0c9b8a1a60f734eb908e98798c72c42998c6ae846e17824daaa2760bf985a.
AGENT-APPROVAL-CONTINUATION-001: runtime/store/transport/native wiring/API UI implemented, disabled by default;
actual locked Eve + real PostgreSQL + full types/build remain acceptance blockers, not VERIFIED.
MIG-REPORT-EXPORT-001: terminal snapshot CSV export + UI + audit; local contracts checked, app/DB acceptance pending.
Primary NEXT_SCOPE_ID remains CRM-PIPE-POSTGRES-005; parallel MIG-APPROVAL-POSTGRES-001;
native acceptance AGENT-APPROVAL-NATIVE-ACCEPTANCE-001. Keep original startedAt/Deal.stage and all evidence.
See ADR 0015, current MASTER reports and the continuation/export runbooks. Historical entries below remain history.

---

# Current checkpoint: 2026-09-14

Authoritative current status/evidence: root MASTER_STATUS.md and MASTER_REPORT.json.
New local scope: bounded Migration Center + one-shot Approval Lifecycle + Team Operations UI/API.
Read ADR 0014 and operator runbook. New schemas are NOT applied and full build/DB/E2E are NOT verified.
No production data touched. Previous sections below are historical, not a current verification claim.

---

# QA Strategy and Test Documentation

## Current master checkpoint — 2026-09-13

**Authoritative current summary:** `MASTER_STATUS.md` / `MASTER_REPORT.json` at the
repository root. Historical sections below describe earlier batches; their
`NEXT_SCOPE_ID` and `INTEGRATION_VERIFIED` wording are not proof of current live
PostgreSQL, deployment, provider or end-to-end verification.

Primary `NEXT_SCOPE_ID`: `CRM-PIPE-POSTGRES-005`.
Parallel migration `NEXT_SCOPE_ID`: `MIG-API-002`.

392/392 dependency-free tests pass, with zero failures/skips; 15/15 local command
gates pass. 29 Chromium standalone theme/layout fixture checks pass separately.
873 TypeScript files parsed and 161 ESM files syntax-checked. No semantic monorepo
typecheck, Bun frozen install, production build, real PostgreSQL, authenticated
Next E2E or live LLM/provider evaluation has passed in this environment.

Implemented local improvements: HTTP/webhook/OpenAPI guards, migration fencing,
CSV/mapping, bounded governed payloads, ambiguous receipts, whole-run retry rules,
explicit safe test DB selection, encrypted source preparation, exact money input,
deterministic deal-health rules, theme preferences and agent-list view models.
API/React wiring exists for appearance, membership checks, deal health, safe errors,
agent filters and retry controls; runtime integration is pending external gates.

No SQL migration or Prisma schema changes were made in this pass. Core CRM remains
single dedicated workspace; 15 existing tenant-ratchet findings are unresolved,
0 new. Migration API/UI/XLSX/importer, full approvals/Control Center, live channels,
localization, onboarding and ROI still require implementation as well as tests.
Do not relabel unfinished implementation as merely missing credentials.

## Quality objective

Demonstrate that releases preserve CRM invariants, tenant isolation, data integrity, agent safety and recoverability. Coverage percentage alone is not a release criterion.

## Test layers

### Unit

Pure domain rules: stage transitions, money/currency, deduplication scoring, permissions, approval policy, retries, scheduling, confidence bands, import mapping and ROI formulas.

### Integration

Prisma repositories against isolated PostgreSQL, transactions/constraints/indexes, queue/Redis behavior, object storage, OAuth/token refresh, provider adapters, webhook deduplication and agent action persistence.

### Contract

HTTP/tRPC schemas, webhook signatures/payload versions, queue event schemas, connector/OpenAPI tools and external provider fakes. Breaking changes require migration/versioning.

### End-to-end

Critical user journeys: onboarding, import, contact/company/deal flow, pipeline transition, connected inbox ingestion, agent creation/simulation/deploy, approval, run recovery, dashboards and role restrictions.

### AI evaluation

Representative, adversarial and regression datasets. Evaluate structured-output validity, groundedness/evidence, tool choice, permission compliance, prompt-injection resistance, false-positive/negative rates, latency and cost. Deterministic business validation remains the final authority.

## Mandatory risk suites

- Tenant A can never read, mutate, search, aggregate or retrieve embeddings belonging to Tenant B.
- Duplicate webhook/job/request produces one business effect.
- Concurrent deal/import/approval mutations cannot lose updates or duplicate records.
- Network timeout, 429, 5xx and provider outage produce bounded, observable recovery.
- Invalid/oversized upload is rejected before parsing or storage side effects.
- Money/currency tests cover zero, negative policy, huge values, rounding boundaries and currency mismatch.
- Time tests cover UTC/display zone, day/month/year boundary, leap year and DST where applicable.
- Secret/PII redaction is tested in logs, traces, errors and snapshots.
- Approval replay, payload mutation and unauthorized approver are rejected.
- Model output outside schema or policy never reaches a tool side effect.

## Bug workflow

1. Reproduce with sanitized evidence and request/correlation ID.
2. Add a failing regression test.
3. Fix the smallest safe surface.
4. Run affected unit/integration/contract/E2E suites.
5. Adversarially test duplicate, concurrent, timeout, partial-failure and invalid-input paths.
6. Document root cause, customer impact, rollback and prevention.

## Release gates

- Manifests valid and BOM-free.
- Repository identity/secret audit passes.
- Formatter and lint pass.
- Typecheck passes.
- Unit and relevant integration/contract/E2E tests pass.
- Production build passes with validated environment.
- Prisma schema/migrations validate; destructive changes reviewed.
- Dependency audit reviewed with no unaccepted critical/high risk.
- Backup/restore and rollback are known for material data changes.
- Product, API, environment, runbook and QA docs are current.

## Execution evidence for this generated release

The final build report is stored in `docs/quality/generated-build-report.json`. A command is considered executed only when it appears there with status `passed`, `failed`, `timeout`, `not_available` or `error`. Failures are not converted into success claims.

## Security R2 test strategy and executed suites

### Credential Vault risk suites

- Valid round trip and absence of plaintext in envelope.
- Random-IV non-determinism.
- Wrong tenant/resource context.
- Ciphertext tampering.
- Missing historical key.
- Key rotation.
- Plaintext rejection outside explicit migration mode.
- Invalid key length and environment configuration.
- Double-encryption prevention.
- Payload size boundary.
- Safe redaction and audit fingerprinting.

### Tenant boundary risk suites

- Server-side tenant injection.
- Cross-tenant selector rejection.
- Cross-tenant create rejection.
- Ownership reassignment rejection.
- Tenant-scoped unique selector.
- Tenant-specific idempotency keys.
- Fail-closed behavior when an underlying delegate returns a foreign-tenant record.
- Scoped mutation arguments.
- Prototype-pollution input rejection.

### Verification limitation

Unit tests prove the new primitives. They do not prove every legacy application query is tenant-safe. `security:tenant-audit` is a regression ratchet only. Full SEC-001 completion requires a database-backed matrix covering every tenant-owned entity, relation traversal, search, export, API key and agent path.


## R7/R8 test strategy

### Automated deterministic suites

- pipeline definition invariants;
- duplicate IDs/keys and non-contiguous ordering;
- terminal probability constraints;
- allowed and forbidden transitions;
- cross-tenant assignment rejection;
- stale optimistic version rejection;
- explicit terminal reopen;
- complete legacy mapping requirement;
- exact very-large minor-unit analytics;
- quoted CSV fields, embedded newlines and escaped quotes;
- BOM and delimiter handling;
- row/column/header constraints;
- spreadsheet formula injection;
- exact money normalization;
- Uzbekistan E.164 normalization;
- MIME/extension/signature validation;
- required mapping validation;
- invalid rows and intra-file duplicates;
- deterministic idempotency and reconciliation.

### External verification still required

- Prisma schema validation with the repository's installed Prisma version;
- migration application on isolated PostgreSQL;
- constraint and query-plan inspection;
- concurrent assignment updates;
- backfill restart and replay;
- transport-level tenant authorization;
- browser/API E2E for pipeline and migration flows.


## R9/R10 verification additions

- idempotent command replay and payload mismatch;
- permission denial at mutation boundary;
- cross-tenant ownership rejection;
- optimistic stale update;
- concurrent deal transitions;
- stage-in-use removal protection;
- atomic default switch;
- invalid migration state transition;
- foreign-tenant dry-run rejection;
- independent worker claims;
- retry with stable operation identity;
- bounded poison-batch failure;
- terminal cancellation.

PostgreSQL transaction, locking and migration tests remain an external release gate.


## R11/R12 verification additions

- private, loopback, link-local, metadata and reserved IP denial;
- host allowlist and URL credential denial;
- address-pinned local HTTP contract test;
- mutation retry/idempotency policy;
- webhook tampering, timestamp and replay;
- external OpenAPI reference rejection;
- action input/output schema rejection;
- permission denial before executor;
- high-risk approval binding;
- operation replay and payload mismatch;
- unsafe high-risk manifest rejection.


## Agent action execution test strategy

Required release cases: malformed model payload; forbidden tenant key; missing permission; object-level denial; policy denial; high-risk action without approval; approval tenant/action/payload mismatch; expired/replayed approval; duplicate and concurrent idempotency; timeout; cancellation; transient retry; executor exception; invalid executor output; secret redaction. PostgreSQL tests must prove atomic receipt acquisition and approval consumption across concurrent workers.


## Durable action-state QA

Database verification must cover simultaneous receipt insert, simultaneous expired-lease recovery, mismatched digest, forged lease token, single-use approval consumption from multiple workers, transaction rollback, database restart and provider-side ambiguous completion.

## AGENT-ACTION-INTEGRATION-002-REPAIR — QA record

### BUG-AA-001 — provider idempotency contract dropped by adapter

- **Severity:** P1 data-integrity/reliability.
- **Environment:** deterministic Node adversarial suite.
- **Steps:** execute a governed mutating action with `idempotencyKey=provider-key` and inspect the executor arguments.
- **Expected:** the executor receives the unchanged provider idempotency key and the canonical operation digest.
- **Actual before repair:** both control fields were omitted by the adapter; the test observed `undefined`.
- **Root cause:** the adapter destructured and reconstructed only `input`, `context`, `signal` and `attempt`.
- **Fix:** pass the complete governed execution envelope through the adapter/application boundary.
- **Regression evidence:** `propagates the operation digest and idempotency key to the executor`.

### BUG-INT-002 — Node 22 pinned lookup callback mismatch

- **Severity:** P1 integration availability.
- **Environment:** Node 22 address-pinned local HTTP contract suite.
- **Steps:** execute a request whose DNS result is validated and pinned by the integration runtime.
- **Expected:** the socket connects only to the validated address.
- **Actual before repair:** Node requested lookup with `{ all: true }`; the scalar callback shape resulted in `ERR_INVALID_IP_ADDRESS`.
- **Root cause:** the custom lookup implemented only the legacy scalar callback contract.
- **Fix:** support both scalar and all-address callback shapes, disable automatic family reselection, validate the pinned address, and retain hostname-based TLS verification.
- **Regression evidence:** local pinned request, redirect-to-private rejection, malformed resolver rejection and slow-trickle total-deadline tests.

### Repair security cases

- A model cannot supply tenant, workspace, organization or execution-control fields.
- Invalid input never reaches an executor.
- Missing action permission or object authorization denies before side effect.
- High/critical actions require a tenant/action/payload-bound approval.
- A consumed, expired, foreign-tenant or changed-payload approval is rejected.
- The same idempotency key with a different digest is rejected.
- Concurrent duplicate execution produces one side-effect owner.
- A pre-aborted request does not acquire a receipt, consume approval or call the executor.
- A non-retry-safe mutation timing out after execution begins is quarantined as ambiguous.
- Executor output is runtime-validated before receipt completion.
- Audit payloads redact secret-bearing keys and common secret value formats.
- Direct catalog execution and direct executor calls outside the governed runtime are blocking audit findings.

### Verification classification

- Dependency-free unit/contract/application integration suites are release-critical for this repair.
- The normal boundary audit must have zero `error` findings.
- The strict legacy audit is expected to remain red until `AGENT-ACTION-INTEGRATION-004-LEGACY-CALLSITE-MIGRATION` removes both known dispatch sites.
- PostgreSQL, real multi-worker, provider, staging and browser checks remain separate gates and must not be represented as passed without execution.

### BUG-PIPE-003 — pipeline runtime leaked domain errors across its public boundary

- **Severity:** P1 API-contract/reliability.
- **Environment:** dependency-free full Node regression suite.
- **Steps:** move a deal with a stale optimistic version through `createPipelineRuntime`.
- **Expected:** the runtime rejects with `PipelineRuntimeError` and code `STALE_ASSIGNMENT`.
- **Actual before repair:** the underlying `PipelineDomainError` escaped the runtime boundary, breaking the documented runtime error contract.
- **Root cause:** pipeline-core validation calls were not translated at the application-runtime boundary.
- **Fix:** wrap every public pipeline runtime operation in one error boundary that preserves existing runtime errors and converts only `PipelineDomainError` instances to `PipelineRuntimeError`.
- **Regression evidence:** stale transition and invalid pipeline-definition tests in `packages/pipeline-runtime/test/runtime.test.mjs`; full dependency-free Node suite.

### BUG-TOOL-004 — executable ESM tools had invalid shebang placement

- **Severity:** P2 developer-experience/release-verification.
- **Environment:** Node 22 syntax sweep across all repository `.mjs` files.
- **Steps:** run `node --check` for every ESM source file.
- **Expected:** executable tools parse successfully.
- **Actual before repair:** four tools placed a blank line before `#!/usr/bin/env node`; Node treated the second-line shebang as invalid syntax.
- **Root cause:** generated files did not preserve the requirement that a shebang be the first byte sequence in the file.
- **Fix:** move the shebang to byte offset zero and include the full ESM syntax sweep in this release gate.
- **Regression evidence:** all repository `.mjs` files pass `node --check`.


### Additional adversarial hardening completed before release packaging

- External/model payloads must be plain JSON records; class instances, accessors and custom serialization hooks are rejected before cloning or hashing.
- The safe clone path never invokes `toJSON`, rejects cycles and unsupported values, and defines sensitive property names without prototype mutation.
- Tenant-key rejection is repeated after action-specific validation so a validator cannot inject `tenantId`, `workspaceId`, `organizationId` or `orgId` into the transformed payload.
- Canonical operation hashing rejects cyclic arrays, non-plain objects and unsafe property names instead of silently normalizing them.
- JSON-schema `required` checks use own-property semantics; inherited prototype members cannot satisfy a required field.
- Policy metadata is fail-closed: `requiresApproval` must be a real boolean when present.
- Correlation identifiers are bounded, non-empty strings before entering audit and executor contexts.
- Secret redaction creates output properties without invoking the `__proto__` setter.
- Regression tests cover malicious `toJSON`, validator-injected tenant ownership, cyclic arrays, unsafe object keys, malformed policy metadata and malformed correlation identifiers.

## AGENT-ACTION-INTEGRATION-004 — legacy callsite migration QA

### BUG-AA-005 — model-facing tools bypassed the governed execution control plane

- **Severity:** P1 security/data-integrity/reliability.
- **Environment:** agent runner production call graph and strict static boundary audit.
- **Steps:** invoke `create_crm_activity` or `post_slack_message` and trace the call to the provider/CRM mutation.
- **Expected:** every side effect passes schema validation, trusted context, authorization, policy, durable idempotency, bounded execution, output validation and audit.
- **Actual before migration:** tools reached legacy action functions through a parallel `AGENT_ACTION_EXECUTORS` dispatch path; the generic governed receipt and policy boundary could be bypassed.
- **Root cause:** the existing run-specific `AgentAction` ledger predated the generic governed action runtime, and the two paths were not composed.
- **Fix:** remove the executor map, introduce one application bridge, retain the run/business ledger behind the governed receipt, and block every other low-level caller.
- **Regression evidence:** `governed-run-action-runtime.test.mjs`, `legacy-agent-action-callsite-migration.test.mjs`, strict `audit-agent-action-boundaries.mjs --check --strict-legacy`, and the generated release gate.

### BUG-AA-006 — ambiguous run/call separator could collide in the compatibility idempotency key

- **Severity:** P1 duplicate-side-effect risk.
- **Environment:** dependency-free governed run-action runtime tests.
- **Steps:** compare `(runId="a:b", callId="c")` with `(runId="a", callId="b:c")`.
- **Expected:** two distinct logical calls can never derive one idempotency identity.
- **Actual before hardening:** both values would produce `a:b:c` if colon-bearing identifiers were accepted.
- **Root cause:** the compatibility key format uses `runId:callId` while identifier validation previously allowed the separator.
- **Fix:** restrict run, call and internal CRM identifiers to a bounded unambiguous alphabet before key derivation, preserving compatibility for existing CUID/UUID/tool-call identifiers.
- **Regression evidence:** `rejects ambiguous identifier separators before deriving an idempotency key`.

### BUG-AA-007 — accessor-backed payload could execute application code during validation

- **Severity:** P1 hostile-input boundary.
- **Environment:** dependency-free governed run-action runtime tests.
- **Steps:** submit a plain object with an enumerable getter for `runId` or an activity field.
- **Expected:** reject the value without invoking the getter or acquiring a receipt.
- **Actual before hardening:** direct property reads could invoke the accessor.
- **Root cause:** plain-prototype validation did not distinguish data properties from accessors.
- **Fix:** snapshot only enumerable own data properties; reject accessors, symbols and unsafe object keys before reading values.
- **Regression evidence:** accessor-backed request and business-input tests assert zero getter invocations.

### Mandatory release cases

- The exact `runId:callId` identity is propagated to the outer governed receipt and existing run-action ledger.
- Same identity and same payload replays one result without another side effect.
- Same identity with changed payload is rejected.
- Missing manifest permission, out-of-scope target or changed trusted context denies before side effect.
- Pre-cancellation does not acquire a receipt or call an executor.
- Invalid policy metadata fails closed.
- Low-level CRM/Slack functions are referenced only by the governed bridge.
- `run.summary` remains run-control state.
- Failure-state persistence detects a changed claim and cannot silently mask the original business error.
- No target-specific test may be skipped or weakened to obtain a green gate.

### External verification still required

- isolated PostgreSQL migration and simultaneous-worker tests;
- generated Prisma client and full dependency-backed semantic typecheck;
- full Bun workspace test/build;
- authenticated staging AgentRun execution;
- live Slack delivery, timeout ambiguity and reconciliation.



## CRM-PIPE-API-003 test record

### Automated suites

- Pipeline domain invariants.
- Pipeline runtime idempotency, permissions, concurrency and lifecycle.
- Prisma adapter tenant scoping, storage/domain mapping, durable receipt/audit mapping, stage swaps and in-use removal.
- API mapping core role permissions, server-owned IDs, transition-key mapping, stage identity preservation and tenant-field omission.
- UI editor model terminal probabilities, key rename propagation, reorder/removal integrity and mutation serialization.
- Static transport/UI boundary audit.

### BUG-PIPE-API-001 — Prisma adapter returned storage rows as domain definitions

- Severity: P1.
- Environment: dependency-free adapter review.
- Steps: read a pipeline through the original Prisma adapter and pass it to `parsePipelineDefinition`.
- Expected: `tenantId`, stage `type` and validated transition arrays.
- Actual: `workspaceId` and `stageType` leaked through, making the runtime incompatible with its own domain contract.
- Root cause: no storage-to-domain mapping at the adapter boundary.
- Fix: normalize every pipeline read/create/update result through `toDomainPipeline` and `parsePipelineDefinition`.
- Regression: `packages/pipeline-runtime/test/prisma-adapter.test.mjs`.

### BUG-PIPE-API-002 — Runtime referenced non-existent idempotency and audit delegates

- Severity: P1.
- Environment: Prisma schema/adaptor inspection.
- Steps: instantiate the original adapter against the generated schema.
- Expected: configured delegates exist.
- Actual: defaults referenced `tenantCommandReceipt` and `tenantSecurityAuditEvent`, neither present in the schema.
- Root cause: foundation-only adapter was not connected to persistence.
- Fix: additive `CrmPipelineCommandReceipt` and `CrmPipelineAuditEvent` models/migration; adapter defaults updated.
- Regression: adapter tests and release verifier.

### BUG-PIPE-API-003 — Stage position/key swaps could violate unique indexes mid-update

- Severity: P1.
- Environment: PostgreSQL unique-index analysis.
- Steps: swap two existing stage positions or keys in one update.
- Expected: atomic reorder.
- Actual: sequential upserts can collide with the still-stored old value.
- Root cause: one-phase replacement under unique `(workspace,pipeline,key/position)` constraints.
- Fix: optimistic parent claim, temporary collision-free keys/positions, upsert final stages, delete removed stages in one transaction.
- Regression: adapter call-order test; isolated PostgreSQL execution remains a release gate.

### BUG-PIPE-API-004 — create-time default selection was silently discarded

- Severity: P1 functional/data-consistency.
- Environment: pipeline settings editor, strict tRPC input contract and pipeline runtime.
- Steps: create a second pipeline, enable “Make this the default pipeline”, and submit it.
- Expected: the new pipeline becomes the sole active default and the previous default receives an optimistic version increment.
- Actual before repair: the editor omitted `isDefault`, the public Zod contract did not accept it, and the runtime forced every non-first create to non-default. The visible checkbox therefore had no effect.
- Root cause: the default intent existed in the editor draft and API-core normalization but was dropped at three independent boundaries.
- Fix: serialize `isDefault` in the client mutation, accept it as a backward-compatible boolean default in the strict public contract, preserve it in the canonical command payload, and let the serializable repository perform the atomic default hand-off.
- Regression evidence: API-core, editor-model, in-memory runtime, Prisma-adapter, static transport-boundary and full dependency-free regression suites.

## CRM-PIPE-DUAL-WRITE-004 test record

### Deterministic coverage

- complete seven-stage mapping validation;
- semantic legacy outcome -> pipeline type compatibility;
- deterministic mapping/reconciliation digests;
- missing, wrong-stage and orphan assignment reconciliation;
- dual-write mode parser defaults to `off` and accepts only `strict` activation;
- idempotent assignment create/no-op/update planning;
- fail-closed invalid mapping/default/type paths;
- deal create and set-stage source boundaries call the bridge inside the same CRM transaction;
- unchanged-stage requests self-heal the sidecar before returning;
- legacy deal reads remain authoritative;
- strict mode prevents unsafe default-pipeline handoff;
- additive SQL contains no destructive legacy deal alteration.

### Residual external gates

- Prisma client generation for the new mapping model;
- isolated PostgreSQL migration execution;
- representative-data backfill/reconciliation;
- concurrent-writer verification;
- full Bun-backed semantic typecheck/build/test;
- authenticated staging E2E.

The checkpoint must not be described as a production read cutover until these external gates and the zero-mismatch observation window are complete.

## CRM-PIPE-POSTGRES-005 preflight record

### Safety invariants

- The PostgreSQL gate requires `TEST_DATABASE_URL` explicitly and never derives it from `DATABASE_URL`.
- The target database name must end in `_test`.
- `TEST_DATABASE_URL === DATABASE_URL` is rejected.
- Missing Bun or installed dependency binaries keeps the scope `BLOCKED_EXTERNAL`; it is never converted into a mocked pass.
- The integration spec exercises the production-style deal row `FOR UPDATE` lock, strict bridge rollback and simultaneous writers.
- Read cutover remains forbidden until the real PostgreSQL gate passes and reconciliation reaches zero over an observation window.

### Current environment

The static verifier and dependency-free gate-boundary tests pass. The actual PostgreSQL integration suite is not executed here because Bun, installed dependencies and an isolated `TEST_DATABASE_URL` are absent.


## MIG-PERSIST-002 test record

### Deterministic coverage

- trusted tenant-scoped durable job reads/writes;
- serializable transaction contract and bounded serialization retry;
- optimistic job and batch versions;
- durable worker leases and expired-lease recovery;
- restart with a new coordinator instance without losing batch state;
- immutable batch identity/range fields and bounded state transitions;
- source filename/format/SHA-256 validation;
- dry-run tenant/entity/index/count/digest validation;
- per-batch imported/rejected accounting;
- deterministic contract mismatch becomes terminal immediately;
- append-only JSON-safe event persistence;
- deterministic completion timestamp;
- schema no longer prevents intentional same-file retry/remapping.

### External verification still required

- Prisma generation and applying both migration persistence migrations to isolated PostgreSQL;
- simultaneous workers and database restart/process-kill recovery;
- real queue/DLQ semantics;
- object-storage upload retention;
- importer side-effect idempotency and rollback/reconciliation;
- API/browser E2E.

This batch improves migration reliability but does not make the Migration Center product complete.
