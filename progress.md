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

# Product Delivery Progress

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

Last updated: 2026-09-13

## Evidence legend

- `[x]` implemented in this release.
- `[~]` existing/foundation present but not yet sufficient for production claim.
- `[ ]` not implemented.
- A feature is not marked complete unless code, verification and documentation support the claim.

## Release baseline completed

- [x] Repository manifests normalized to UTF-8 without BOM.
- [x] First-party package author/license metadata and shallow project license files removed per owner instruction.
- [x] Legacy first-party identity sweep and repository audit gate added.
- [x] Hard-coded telemetry project configuration replaced where detected; telemetry defaults documented as opt-in/disabled.
- [x] Repository quality audit, manifest verification and deterministic tests added.
- [x] CI quality/security workflows restored.
- [x] Project-specific `rules.md`, `agents.md`, `progress.md` and `qa.md` created.
- [x] Architecture, security, release, incident and ADR documentation added.
- [x] Dependency-free deterministic core primitives and tests added for idempotency, money, agent approvals, retries, connector URL safety, pipeline rules, deal health, import normalization and ROI.

## Existing product capability — requires environment verification

- [~] Contacts, companies, deals and activities.
- [~] Gmail/Google Calendar/Outlook/Slack and website tracking foundations.
- [~] Agent definitions, immutable versions, triggers, runs, actions, events and audit records.
- [~] Evidence/confidence-oriented contact intelligence.
- [~] Authentication, organization membership, API keys and SSO-related foundations.
- [~] Tests/evals already present in the source tree.

## Must build before broad commercial rollout

- [ ] True tenant/workspace isolation with automated cross-tenant tests.
- [~] Configurable multiple pipelines, API and dual-write bridge; PostgreSQL proof/read cutover remain.
- [~] UTF-8 CSV/TSV, mapping, dry-run and encrypted preparation CLI; Migration Center API/UI, XLSX, live importer and rollback execution remain.
- [ ] Telegram-first unified inbox; then WhatsApp Business and Instagram.
- [ ] Credential envelope encryption/KMS and rotation.
- [ ] Durable jobs, DLQ/replay and provider webhook idempotency across all ingestion paths.
- [ ] Agent policy engine, signed approvals, action replay protection and kill switch.
- [ ] Agent Control Center with live runs, incidents, approvals, cost and outcome metrics.
- [~] Deterministic evidence-backed deal-health rules and record-sheet wiring; live DB/API/browser verification remains.
- [ ] Role-aware CEO/Sales/Operations dashboards.
- [ ] RU/UZ/EN localization, UZS/USD/RUB and +998 normalization.
- [ ] Managed pilot deployment, backup/restore drill, monitoring and operational SLOs.

## Strategic sequence

1. Production safety and tenant isolation.
2. Configurable CRM and migration.
3. Local communication channels and ready-made agents.
4. Agent governance and Control Center.
5. Deal Intelligence and verified analytics.
6. Generic webhooks/REST/OpenAPI/MCP Integration Studio.
7. Custom objects and non-CRM agents.
8. Shared SaaS control plane, data regions and global self-service.

## Explicit non-claim

This repository release is a production-engineering foundation. It does not falsely claim that the complete multi-year roadmap, every competitor feature, every external integration or an error-free AI system was implemented in one build. Each remaining item must pass the same release gates before its checkbox can change.

## 2026-08-30 — Security R2

### Implemented

- Added `@crm/security-core` with a versioned AES-256-GCM credential envelope.
- Bound encrypted credentials to tenant/resource/field/purpose through authenticated AAD.
- Added environment and in-memory key providers, active-key rotation and explicit legacy migration codec.
- Added immutable tenant context, scoped query/mutation builders, fail-closed result checks and tenant-bound idempotency keys.
- Added CI-compatible credential configuration validation.
- Added tenant-boundary static regression ratchet and generated baseline/report.
- Added crypto, tamper, wrong-context, wrong-key, rotation, plaintext-rejection and cross-tenant unit tests.
- Added ADR, security standards and key-rotation runbook.

### Not yet closed

- Existing persisted OAuth/integration credential fields still require additive encrypted columns, dual-write, backfill, reconciliation and plaintext-column retirement.
- Existing API/repository paths still require systematic migration to trusted request tenant context and database-backed cross-tenant integration tests.
- Live cloud KMS verification requires target-provider credentials.

These items remain `IN_PROGRESS`; they are not represented as completed merely because the reusable primitives exist.


## 2026-08-31T17:03:19.465570+00:00 — Autonomous R7/R8

- [x] Configurable pipeline domain and transition invariants.
- [x] Optimistic assignment versioning and explicit terminal reopen policy.
- [x] Deterministic legacy-stage migration planning.
- [x] Exact minor-unit pipeline analytics.
- [x] Additive Prisma/SQL pipeline and migration persistence models.
- [x] Bounded CSV/TSV parsing and mapping.
- [x] Formula-injection-safe generated CSV reports.
- [x] Deterministic dedupe, dry-run, batching, idempotency and reconciliation.
- [ ] Trusted tenant pipeline API and UI.
- [ ] PostgreSQL migration and concurrency verification.
- [ ] XLSX worksheet adapter.
- [ ] Resumable migration worker and rollback execution.

NEXT_SCOPE_ID: CRM-PIPE-API-002


## 2026-08-31T17:07:04.441185+00:00 — Autonomous R9/R10

- [x] Transaction-bound pipeline command runtime.
- [x] Tenant/action permission enforcement.
- [x] Idempotency payload hashing and replay protection.
- [x] Optimistic pipeline and deal-assignment concurrency.
- [x] Atomic default-pipeline switch contract.
- [x] Restart-safe migration state machine.
- [x] Lease-based batch claiming.
- [x] Deterministic importer idempotency keys.
- [x] Checkpointing and bounded retry.
- [x] Poison batch and cancellation behavior.
- [ ] Real tRPC/HTTP pipeline consumer and UI.
- [ ] Prisma/PostgreSQL runtime integration suite.
- [ ] Migration upload/API/UI and durable queue.

NEXT_SCOPE_ID: CRM-PIPE-API-003


## 2026-08-31T17:10:43.085341+00:00 — Autonomous R11/R12

- [x] SSRF-safe pinned outbound HTTP boundary.
- [x] Bounded timeout, response, redirect and retry policies.
- [x] Mutation retry requires idempotency.
- [x] HMAC webhook verification and replay defence.
- [x] OpenAPI operation discovery without external refs.
- [x] Typed governed agent action registry.
- [x] Permission and risk classification.
- [x] Payload-bound expiring approvals.
- [x] Idempotent execution replay and audit.
- [ ] Durable replay/execution persistence.
- [ ] OAuth/credential UI.
- [ ] Existing agent runtime/action manifest integration.

NEXT_SCOPE_ID: AGENT-ACTION-INTEGRATION-002


## Governed agent action execution checkpoint

- Added a single fail-closed action execution path for model proposals.
- Added tenant override protection, permission and object authorization, policy enforcement, payload-bound approval consumption, receipt-based idempotency, bounded timeout/cancellation, output validation and redacted audit events.
- Added the `apps/agent` composition module and workspace dependency.
- Added deterministic adversarial tests.
- Remaining: durable Prisma adapters, migration of every legacy direct executor call site, PostgreSQL concurrency verification and staging E2E.
- NEXT_SCOPE_ID: `AGENT-ACTION-INTEGRATION-003-DURABLE-STORES`


## Durable governed-action state

- Added Prisma-compatible receipt, approval and audit adapters.
- Added additive data models and migration.
- Added lease-token hashing, optimistic lease acquisition, atomic approval consumption and redacted audit persistence.
- Added deterministic adapter tests and a direct-action boundary audit.
- Remaining external gates: Prisma generation, isolated PostgreSQL migration/concurrency suite, legacy direct-call-site remediation and staging E2E.
- NEXT_SCOPE_ID: `AGENT-ACTION-INTEGRATION-004-LEGACY-CALLSITE-MIGRATION`

## Autonomous checkpoint — governed action integration

- Critical deterministic gate: **false**.
- Verification statuses: `{"failed": 1, "not_available": 2, "passed": 9}`.
- Boundary audit findings: **2**.
- Remaining critical failures: Agent action runtime adversarial tests.
- NEXT_SCOPE_ID: `AGENT-ACTION-INTEGRATION-002-REPAIR`.










## Authoritative autonomous checkpoint — agent governance

- Batch-specific critical gate: **false**.
- Statuses: `{"failed": 1, "not_available": 1, "passed": 15}`.
- Critical failures: Final action runtime adversarial suite.
- Boundary findings requiring migration review: **2**.
- NEXT_SCOPE_ID: `AGENT-ACTION-INTEGRATION-002-REPAIR`.

## 2026-09-01 — AGENT-ACTION-INTEGRATION-002-REPAIR

### Implemented

- Reproduced the persisted failure where the executor adapter dropped `idempotencyKey` and `operationDigest`.
- Preserved the complete governed executor contract through application composition.
- Removed the parallel registry execution engine; `@crm/action-registry` is now catalog-only.
- Removed registry-owned approval and in-memory action-state modules.
- Replaced the implicit/fallback application composition with explicit fail-fast dependencies.
- Added strict model-proposal, manifest, permission, retry, tenant-override and cancellation validation.
- Ensured a pre-aborted request does not acquire a durable receipt or consume a one-time approval.
- Kept one execution boundary for schema validation, authorization, policy, approval, idempotency, bounded side effects, output validation and redacted audit.
- Added/strengthened Prisma receipt, approval and audit store contract tests.
- Added a production-source boundary audit and a separate strict legacy-migration gate.
- Repaired Node 22 pinned DNS lookup compatibility and added a wall-clock HTTP deadline.
- Removed stale first-party identity values and stale generated foundation evidence that prevented the repository audit from passing.
- Added a deterministic release verifier and root repair gate.

### Verified in this batch

- Action catalog tests.
- Governed runtime adversarial tests.
- Durable Prisma-store contract tests using a deterministic fake transactional client.
- Agent application composition tests.
- Integration-runtime local HTTP/SSRF/deadline tests.
- Boundary-audit tests and non-strict production audit.
- Manifest parsing and repository identity/secret/BOM audit.
- Repair release structural verifier.

### Explicitly not closed

- The two legacy `AGENT_ACTION_EXECUTORS` dispatch sites are still migration findings.
- Isolated PostgreSQL migration and true multi-worker concurrency verification remain required.
- Live provider reconciliation and staging authentication/tenant E2E remain required.
- Full Bun-backed monorepo lint/typecheck/test/build is recorded according to actual tool availability.

NEXT_SCOPE_ID: `AGENT-ACTION-INTEGRATION-004-LEGACY-CALLSITE-MIGRATION`

### Final repair regression sweep

- [x] Full dependency-free Node test inventory passes after the governed-action repair.
- [x] Pipeline runtime translates pipeline-domain failures into its public runtime error contract.
- [x] All executable ESM tool shebangs are located at byte offset zero.
- [x] All repository `.mjs` files pass Node syntax validation.
- [x] Normal governed-action boundary audit has zero blocking findings.
- [ ] Strict legacy boundary audit remains intentionally red for the two known dispatch sites.
- [ ] Bun-backed full monorepo lint/typecheck/build remains unavailable without Bun and installed workspace dependencies.

NEXT_SCOPE_ID: `AGENT-ACTION-INTEGRATION-004-LEGACY-CALLSITE-MIGRATION`

## 2026-09-01 — AGENT-ACTION-INTEGRATION-004-LEGACY-CALLSITE-MIGRATION

### Implemented

- [x] Removed the production `AGENT_ACTION_EXECUTORS` dispatch map.
- [x] Classified external side effects as `GOVERNED` and kept `run.summary` as `RUN_CONTROL`.
- [x] Migrated CRM activity and Slack model-facing tools to one application-owned governed bridge.
- [x] Derived tenant, actor, request, correlation and permissions from persisted server-side run state.
- [x] Revalidated immutable manifest actions, CRM data scope and Slack destination before execution.
- [x] Propagated the provider idempotency key, canonical operation digest, attempt and cancellation signal without loss.
- [x] Preserved the existing `AgentAction` product ledger behind the generic governed receipt.
- [x] Made any direct low-level run-side-effect caller a blocking repository finding.
- [x] Added hostile-object, identifier-collision, malformed-policy, cancellation, replay and boundary regression cases.
- [x] Made run-action failure persistence claim-aware and preserved both original and state-write failure evidence.

### Verification boundary

- Dependency-free targeted, adversarial and repository regression tests are release-critical.
- The strict agent-action boundary audit must report zero errors and zero legacy migration findings.
- TypeScript syntax is checked independently when the compiler API is available.
- Semantic workspace typecheck/build, PostgreSQL multi-worker verification and live Slack/staging E2E remain separate environment gates.

NEXT_SCOPE_ID: `CRM-PIPE-API-003`



## 2026-09-01 — CRM-PIPE-API-003

- [x] Added authenticated, membership-verified pipeline API routes.
- [x] Removed tenant/workspace selectors from public pipeline DTOs.
- [x] Added owner/admin management permissions and member read permissions.
- [x] Added durable pipeline command receipts and audit events.
- [x] Fixed Prisma storage-to-domain mapping and missing delegate configuration.
- [x] Added collision-free stage reorder/update and in-use removal protection.
- [x] Added optimistic update/archive/restore versions and mutation idempotency keys.
- [x] Connected the generated tRPC client and a functional settings UI.
- [x] Preserved the create-time “make default” intent through UI, public contract, idempotency payload and serializable persistence.
- [x] Added loading, error, empty and success UX plus keyboard-focusable controls.
- [x] Added `gate:pipeline-api` with persisted command evidence and fail-closed critical status.
- [x] Passed 80/80 targeted and 244/244 dependency-free regression tests in the available environment.
- [ ] Apply and exercise the migration against isolated PostgreSQL.
- [ ] Run dependency-backed formatter/lint/typecheck/build and browser E2E.
- [ ] Add legacy-stage dual-write/backfill/reconciliation before deal reads switch.

NEXT_SCOPE_ID: `CRM-PIPE-DUAL-WRITE-004`

## 2026-09-05 — CRM-PIPE-DUAL-WRITE-004

- [x] Added explicit persisted mapping for all legacy `DealStage` values.
- [x] Added semantic mapping validation so open/won/lost meaning cannot drift.
- [x] Added deterministic reconciliation with missing/wrong/orphan mismatch classes.
- [x] Added opt-in `off|strict` dual-write gate; default remains off.
- [x] Connected deal creation and legacy stage changes to the sidecar inside the same CRM transaction.
- [x] Added idempotent self-healing for unchanged legacy stage requests.
- [x] Added optimistic assignment updates and fail-closed concurrency behavior.
- [x] Guarded default-pipeline handoff while strict bridge mode is active.
- [x] Added dry-run-first bounded mapping/backfill/reconciliation operational tool.
- [x] Kept legacy `Deal.stage` authoritative and made no destructive schema change.
- [x] Added ADR-0011, expanded rollout/rollback runbook and dedicated verification gate.
- [ ] Generate Prisma client and execute migration in isolated PostgreSQL.
- [ ] Execute representative backfill and prove zero mismatches.
- [ ] Run simultaneous-writer PostgreSQL verification.
- [ ] Run dependency-backed Bun formatter/lint/typecheck/test/build.
- [ ] Run authenticated staging/browser E2E and observation-window reconciliation.
- [ ] Switch reads only in a later explicitly verified checkpoint.

NEXT_SCOPE_ID: `CRM-PIPE-POSTGRES-005`

## 2026-09-05 — CRM-PIPE-POSTGRES-005 verification harness

### Prepared

- [x] Added a Bun/PostgreSQL integration spec for atomic legacy + sidecar writes.
- [x] Added rollback coverage proving a strict bridge failure reverts the legacy Deal.stage write.
- [x] Added simultaneous-writer coverage using the production-style `FOR UPDATE` row lock pattern.
- [x] Added a release gate that requires an explicit `TEST_DATABASE_URL`, requires an `_test` database name, rejects equality with `DATABASE_URL`, and never falls back to the live URL.
- [x] Added a structural verifier and dependency-free safety-boundary tests for the PostgreSQL gate.
- [ ] Execute the gate with Bun, installed dependencies and an isolated PostgreSQL test database.
- [ ] Apply migrations, generate Prisma, and prove the integration suite green in that environment.
- [ ] Only after the PostgreSQL gate passes, start a shadow-read/zero-mismatch observation window.

Current environment status: **BLOCKED_EXTERNAL** — Bun, installed workspace dependencies and `TEST_DATABASE_URL` are unavailable. This is not treated as a production-read-cutover pass.

NEXT_SCOPE_ID: `CRM-PIPE-POSTGRES-005`


## 2026-09-05 — MIG-PERSIST-002 durable migration runtime

- [x] Added a tenant-scoped Prisma repository for migration jobs, batches and append-only runtime events.
- [x] Persisted leases, retry attempts, imported/rejected counters, optimistic versions and deterministic completion timestamps.
- [x] Proved coordinator restart/recovery against the same durable repository state.
- [x] Added strict dry-run entity, row-count, batch-sequence and digest invariants.
- [x] Added repository-owned immutable batch fields and fail-closed batch transition validation.
- [x] Made importer outcome count mismatches terminal instead of wasting retries.
- [x] Added final job accounting invariant before `COMPLETED`.
- [x] Sanitized event details to durable JSON and rejected non-serializable values.
- [x] Rejected unsafe source filenames before persistence.
- [x] Replaced the incorrect unique `(workspace, source hash, entity)` rule with a normal index so an intentional re-import/remap of the same file is possible.
- [ ] Apply and exercise the durability migration against isolated PostgreSQL.
- [ ] Run real process-kill/multi-worker recovery and queue tests.
- [ ] Connect upload/API/UI and real entity importers.

Primary NEXT_SCOPE_ID: `CRM-PIPE-POSTGRES-005`

Migration NEXT_SCOPE_ID: `MIG-API-002`
