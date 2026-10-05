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

# Current override — 2026-09-14

Read root MASTER_STATUS.md / MASTER_REPORT.json first. Historical tables below are not a current
completion claim. MIG-API-002 now has bounded create-only contact/company CSV/TSV API + UI + receipts +
archive rollback. Bound approvals/policy and team operations API/UI are implemented. Their local
contracts pass; full DB, toolchain and authenticated E2E remain unverified. Two additive SQL migrations
were authored, not applied. Legacy Deal.stage and dedicated workspace assumptions remain.

Primary NEXT_SCOPE_ID: CRM-PIPE-POSTGRES-005.
Parallel DB gate: MIG-APPROVAL-POSTGRES-001.
Independent code next: AGENT-APPROVAL-CONTINUATION-001.

The older heading and status rows below describe the Sep13 snapshot, preserved as history.

---

# Master Scope Ledger

## Current master checkpoint — 2026-09-13

**Authoritative current summary:** `../../MASTER_STATUS.md` / `../../MASTER_REPORT.json` at the
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


Status values: `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED`, `BLOCKED_EXTERNAL`.
Verification values: `NOT_VERIFIED`, `STATIC_VERIFIED`, `UNIT_VERIFIED`, `INTEGRATION_VERIFIED`, `E2E_VERIFIED`, `LIVE_VERIFIED`.

A feature is never marked implemented for UI-only, backend-only or adapter-only work.

| ID | Requirement | Current state | Dependencies | Implementation | Verification | Tests / evidence | Documentation | Residual risk |
|---|---|---|---|---|---|---|---|---|
| CORE-001 | Reproducible repository quality gate | Node lane runs actual local workspace exports; mandatory full tasks and lock metadata repaired | Bun/dependencies/CI | IN_PROGRESS | UNIT_VERIFIED | 15 local gates, 392 tests | MASTER_STATUS.md | Frozen install, formatter/lint, semantic types and build not executed |
| SEC-001 | End-to-end tenant isolation | Legacy workspace assumptions remain | Auth context, repository migration, DB tests | IN_PROGRESS | UNIT_VERIFIED | security-core tenant tests + static ratchet | docs/security/tenant-isolation.md | Existing routes require migration and DB-backed adversarial tests |
| SEC-002 | Credential Vault | Vault primitive and migration codec implemented | Secret manager/KMS, schema migration | IN_PROGRESS | UNIT_VERIFIED | security-core crypto/tamper/rotation tests | docs/security/credential-vault.md | Persisted credential fields are not yet fully migrated |
| SEC-003 | Object/action/agent/integration permissions | Dedicated membership recheck, bounded governed payload and retry denial implemented | Real auth/DB/provider verification | IN_PROGRESS | UNIT_VERIFIED | workspace/access, payload and retry tests | MASTER_AUDIT.md | Not exhaustive field-level or shared-tenant authorization |
| DB-001 | Schema constraints/index/query hardening | Existing Prisma schema | Production query inventory | NOT_STARTED | NOT_VERIFIED | — | — | Unknown unbounded/N+1 paths |
| CRM-001 | Configurable multiple pipelines | Prior API/UI/dual-write retained; test database guard strengthened; legacy reads authoritative | Safe expand/contract and real PostgreSQL | IN_PROGRESS | UNIT_VERIFIED | prior deterministic gates plus DB guard tests | ADR-0011/0013 | PostgreSQL rollout and read cutover still blocked |
| CRM-002 | Production custom fields | Partial implementation | Permissions/filtering/serialization | NOT_STARTED | NOT_VERIFIED | — | — | Feature coverage unknown |
| MIG-001 | CSV/XLSX Migration Center | CSV/mapping/fencing fixed; encrypted source and new-process preparation CLI tested | Public API, durable importer and DB | IN_PROGRESS | UNIT_VERIFIED | migration suites, real filesystem/child-process tests | source preparation runbook | No XLSX parser, complete API/UI, CRM importer or rollback execution |
| INBOX-001 | Unified communication domain | Channel-specific integrations exist | Data model + sync jobs | NOT_STARTED | NOT_VERIFIED | — | — | No normalized inbox |
| AI-001 | Self-maintaining CRM hygiene engine | Evidence foundations exist | Data-quality jobs | NOT_STARTED | NOT_VERIFIED | — | — | Recommendations not productized |
| AI-002 | Deterministic Deal Intelligence | Versioned rule/evidence engine and deal-sheet API/UI wiring | PostgreSQL and authenticated app | IN_PROGRESS | UNIT_VERIFIED | 10 deal-health tests; TS syntax | MASTER_AUDIT.md | Read-only heuristic, not a win probability; app integration unverified |
| AGENT-001 | Production Agent Runtime | Strong existing foundation | Policy/action expansion | IN_PROGRESS | STATIC_VERIFIED | existing tests + future integration tests | agents.md | Action surface and approvals incomplete |
| AGENT-002 | Agent Control Center | Team agent filters/latest-run observability and guarded retry improved | Runtime metrics/approvals/incidents | IN_PROGRESS | UNIT_VERIFIED | agent view model and retry tests | MASTER_AUDIT.md | Not full Control Center; no invented global outcomes/ROI |
| INT-001 | Integration Studio | HTTP/webhook/OpenAPI runtime hardened | Durable replay store, endpoints, credentials UI | IN_PROGRESS | UNIT_VERIFIED | 24 integration tests | MASTER_AUDIT.md | Studio and production connectors are not end-to-end implemented |
| UX-001 | Role-aware premium UX | Four palette pairs, mode/density/navigation preferences; search/error/deal/agent improvements wired | Running app and user validation | IN_PROGRESS | UNIT_VERIFIED | preference/model tests; 29 separate fixture browser checks | MASTER_UX_AUDIT.md | Not authenticated React E2E or full accessibility certification |
| QA-001 | Full release-gate strategy | Repeatable local report/log, isolated PG gate and separate CI lanes | Full environment | IN_PROGRESS | UNIT_VERIFIED | master local gate, fail-closed PG report | qa.md | No full build, live E2E/load/restore evidence |



<!-- AUTONOMOUS-R7-R8-SCOPE -->
## Autonomous R7/R8 — Configurable Pipeline and Migration Core

| ID | Requirement | Current State | Implementation Status | Verification Status | Tests | Documentation | Residual Risk |
|---|---|---|---|---|---|---|---|
| CRM-PIPE-001 | Deterministic configurable pipeline domain with custom stages, semantics, probability and transition rules | Domain package and additive database sidecar implemented | IMPLEMENTED | UNIT_VERIFIED | `packages/pipeline-core/test/pipeline.test.mjs` | `docs/architecture/configurable-pipelines.md` | Transport/UI integration and live PostgreSQL verification remain |
| CRM-PIPE-002 | Safe expand/contract replacement of hardcoded DealStage | Additive sidecar, explicit persisted mapping, strict transactional dual-write and bounded backfill/reconciliation tooling implemented; legacy reads retained | IN_PROGRESS | INTEGRATION_VERIFIED | mapping/reconciliation, bridge and boundary tests | `docs/runbooks/deal-stage-expand-contract.md`, ADR-0011 | Isolated PostgreSQL rollout, observation window and read cutover remain |
| MIG-CSV-001 | Safe CSV/TSV parsing, validation, mapping, dedupe, dry-run, batching and reconciliation | Core implemented without external dependencies | IMPLEMENTED | UNIT_VERIFIED | `packages/migration-core/test/migration.test.mjs` | `docs/architecture/migration-center.md` | Persistence/API/UI integration remains |
| MIG-XLSX-001 | XLSX import | File/MIME/signature boundary implemented; worksheet parser intentionally not claimed | IN_PROGRESS | UNIT_VERIFIED | Signature and filename tests | `docs/architecture/migration-center.md` | Requires bounded XLSX adapter and fixture/contract suite |
| MIG-PERSIST-001 | Restart-safe migration job persistence and resumable batches | Additive schema and SQL persistence foundation implemented | IMPLEMENTED | STATIC_VERIFIED | Structural release verifier | `docs/architecture/migration-center.md` | Runtime/database integration tracked separately |
| MIG-PERSIST-002 | Durable Prisma migration runtime integration | Prisma repository, optimistic versions, leases/counters/events, restart recovery and strict batch accounting implemented | IMPLEMENTED | INTEGRATION_VERIFIED | `packages/migration-runtime/test/*.test.mjs`, migration persistence boundary/gate | ADR-0012, `DELIVERY_MIGRATION_PERSIST_002.md`, migration runtime docs | Isolated PostgreSQL, real queue/process-kill and end-to-end importer remain external |

NEXT_SCOPE_ID: `CRM-PIPE-API-002`


<!-- AUTONOMOUS-R9-R10-SCOPE -->
## Autonomous R9/R10 — Application runtimes

| ID | Requirement | Current State | Implementation Status | Verification Status | Tests | Residual Risk |
|---|---|---|---|---|---|---|
| CRM-PIPE-RUNTIME-001 | Transactional tenant-scoped pipeline commands | Runtime, in-memory transactional repository and Prisma adapter implemented | IMPLEMENTED | UNIT_VERIFIED | `packages/pipeline-runtime/test/runtime.test.mjs` | Live Prisma/PostgreSQL tests remain |
| CRM-PIPE-API-002 | Trusted tenant API and UI | Runtime boundary exists, transport is not connected | IN_PROGRESS | STATIC_VERIFIED | Runtime permission and cross-tenant tests | Actual tRPC/HTTP consumers and UI remain |
| MIG-RUNTIME-001 | Restart-safe migration state machine and worker | Coordinator, leases, checkpoints, bounded retries and cancellation implemented | IMPLEMENTED | UNIT_VERIFIED | `packages/migration-runtime/test/runtime.test.mjs` | Durable Prisma/queue adapter remains |
| MIG-API-002 | Migration Center API/UI | Runtime exists, transport is not connected | IN_PROGRESS | STATIC_VERIFIED | Runtime tests | Upload, UI and E2E remain |

NEXT_SCOPE_ID: `CRM-PIPE-API-003`


<!-- AUTONOMOUS-R11-R12-SCOPE -->
## Autonomous R11/R12 — Integration and governed actions

| ID | Requirement | Current State | Implementation Status | Verification Status | Residual Risk |
|---|---|---|---|---|---|
| INT-HTTP-001 | Safe generic HTTP connector runtime | Pinned DNS, SSRF policy, redirects, limits, timeout and retry implemented | IMPLEMENTED | UNIT_VERIFIED | Live provider and proxy environments remain |
| INT-WEBHOOK-001 | Signed incoming webhooks and replay defence | HMAC/timestamp/replay core implemented | IMPLEMENTED | UNIT_VERIFIED | Durable replay store and endpoint integration remain |
| INT-OPENAPI-001 | OpenAPI tool discovery | Local 3.x documents compiled to bounded typed manifests | IMPLEMENTED | UNIT_VERIFIED | OAuth/credential UI and broader schema support remain |
| AGENT-ACTION-001 | Catalog-only governed action definitions | Immutable manifests, schemas, permissions, risk, idempotency semantics and executors are registered without an execution API | IMPLEMENTED | UNIT_VERIFIED | Legacy runtime dispatch consumers still require migration through the governed application boundary |

NEXT_SCOPE_ID: `AGENT-ACTION-INTEGRATION-002`

<!-- AGENT-ACTION-INTEGRATION-002-REPAIR -->
## Governed action integration repair

| ID | Requirement | Current State | Implementation Status | Verification Status | Tests / evidence | Documentation | Residual Risk |
|---|---|---|---|---|---|---|---|
| AGENT-ACTION-INTEGRATION-002-REPAIR | One fail-closed execution path from model proposal to validated audited side effect | Catalog-only registry, governed runtime, explicit app composition and durable Prisma adapters are connected; the failed idempotency propagation test is repaired | IMPLEMENTED | INTEGRATION_VERIFIED | Action catalog, runtime, Prisma-store, app-composition, integration-runtime and boundary-audit suites; `verify-agent-action-repair.mjs` | `DELIVERY_AGENT_ACTION_REPAIR.md`, ADR-0008, action-registry architecture | PostgreSQL multi-worker and staging transport verification remain external gates |
| INT-HTTP-NODE22-001 | Address-pinned outbound HTTP remains compatible with Node 22 lookup-all behavior | Pinned lookup returns the correct callback shape for scalar and `{ all: true }` modes; total request deadline added | IMPLEMENTED | INTEGRATION_VERIFIED | Local address-pinned HTTP, redirect SSRF and slow-trickle deadline tests | `docs/architecture/integration-runtime.md` | Live proxy/provider environments remain |
| REPO-HYGIENE-002 | First-party identity and stale generated evidence do not break repository audit | Remaining stale identity test data removed; current build evidence replaces stale generated foundation files | IMPLEMENTED | INTEGRATION_VERIFIED | Repository audit and repository-audit regression suite | `DELIVERY_AGENT_ACTION_REPAIR.md` | Detection patterns intentionally remain in the audit implementation |
| AGENT-ACTION-INTEGRATION-004-LEGACY-CALLSITE-MIGRATION | Route every model-facing CRM/Slack action call through the governed service and eliminate the legacy executor map | Agent tools use the governed run bridge; the strict boundary audit has zero legacy or blocking findings | IMPLEMENTED | INTEGRATION_VERIFIED | `governed-run-action-runtime.test.mjs`, `legacy-agent-action-callsite-migration.test.mjs`, complete action-runtime suites and strict audit | `DELIVERY_LEGACY_AGENT_ACTION_MIGRATION.md`, ADR-0009, `docs/architecture/agent-run-action-execution.md` | Full Bun semantic typecheck/build, isolated PostgreSQL multi-worker verification and live Slack/staging E2E remain separate gates |
| REGRESSION-PIPELINE-003 | Preserve the pipeline runtime public error contract while reusing pipeline-core domain validation | Public operations now translate only `PipelineDomainError` into `PipelineRuntimeError`; unknown infrastructure errors still propagate | IMPLEMENTED | INTEGRATION_VERIFIED | Pipeline runtime regression tests and complete dependency-free Node suite | `qa.md` BUG-PIPE-003 | Prisma/PostgreSQL transport verification remains separate |
| REPO-TOOLING-004 | Ensure all executable ESM tools are syntactically valid under Node | Four second-line shebangs moved to byte offset zero; repository-wide `.mjs` syntax sweep added to evidence | IMPLEMENTED | STATIC_VERIFIED | Repository-wide `node --check` sweep | `qa.md` BUG-TOOL-004 | Full Bun-backed toolchain remains unavailable in this environment |

NEXT_SCOPE_ID: `CRM-PIPE-API-003`


<!-- CRM-PIPE-API-003 -->
## CRM-PIPE-API-003 — Trusted configurable-pipeline API and settings UI

| ID | Requirement | Current State | Dependencies | Implementation Status | Verification Status | Tests | Documentation | Residual Risk |
|---|---|---|---|---|---|---|---|---|
| CRM-PIPE-API-003 | Connect configurable pipelines to an authenticated tenant-scoped API and functional settings UI | Nest/tRPC module, validated contracts, role permissions, durable idempotency/audit persistence, generated client surface and settings editor are connected | `CRM-PIPE-001`, `CRM-PIPE-RUNTIME-001` | IMPLEMENTED | INTEGRATION_VERIFIED | `gate:pipeline-api`: 80/80 targeted and 244/244 dependency-free regression tests; structural, repository, security and tenant-boundary gates | ADR-0010, `docs/architecture/pipeline-api.md`, rollout runbook, generated report/log | Dependency-backed monorepo build and isolated PostgreSQL/staging E2E remain external environment gates |
| CRM-PIPE-DB-003 | Make the Prisma pipeline runtime executable with storage/domain mapping and durable command receipts | Adapter maps records, handles stage swaps/removals, uses real receipt/audit delegates and recovers committed idempotent results | `CRM-PIPE-RUNTIME-001` | IMPLEMENTED | INTEGRATION_VERIFIED | `packages/pipeline-runtime/test/prisma-adapter.test.mjs` | ADR-0010, pipeline API architecture | PostgreSQL-specific locking and concurrent unique-conflict behavior require isolated DB verification |
| CRM-PIPE-UI-003 | Allow owners/admins to create, edit, default, archive and restore pipelines | Responsive settings page and stage editor connected to generated tRPC surface | `CRM-PIPE-API-003` | IMPLEMENTED | STATIC_VERIFIED | Editor model and source-boundary tests | Pipeline API architecture | Browser E2E, visual regression and accessibility automation require app dependencies/runtime |

NEXT_SCOPE_ID: `CRM-PIPE-DUAL-WRITE-004`

<!-- CRM-PIPE-DUAL-WRITE-004 -->
## CRM-PIPE-DUAL-WRITE-004 — Legacy DealStage bridge

| ID | Requirement | Current State | Dependencies | Implementation | Verification | Tests / evidence | Documentation | Residual Risk |
|---|---|---|---|---|---|---|---|---|
| CRM-PIPE-DUAL-WRITE-004 | Backfill configurable assignments and atomically mirror legacy deal stage writes without losing rollback | Explicit seven-stage mapping, semantic validation, strict transactional dual-write, idempotent self-heal, bounded backfill/reconciliation and default-pipeline guard implemented | `CRM-PIPE-API-003`, additive mapping migration | IMPLEMENTED | INTEGRATION_VERIFIED | 96/96 targeted tests plus full dependency-free regression gate | ADR-0011, `DELIVERY_CRM_PIPE_DUAL_WRITE_004.md`, expand/contract runbook | PostgreSQL rollout/read cutover remains external; legacy reads remain authoritative |
| CRM-PIPE-POSTGRES-005 | Prove migration, transactional rollback and simultaneous-writer correctness against isolated PostgreSQL before read cutover | Safe test-only gate harness and Bun/PostgreSQL integration spec implemented; gate refuses live DB fallback | `CRM-PIPE-DUAL-WRITE-004`, Bun/dependencies, explicit `TEST_DATABASE_URL` ending `_test` | IN_PROGRESS | BLOCKED_EXTERNAL | structural verifier + test-only safety boundary; actual PostgreSQL suite not executable in current environment | `qa.md`, expand/contract runbook | Requires Bun, installed dependencies and isolated PostgreSQL; no read cutover until this gate passes |

NEXT_SCOPE_ID: `CRM-PIPE-POSTGRES-005`


## 2026-09-05 — MIG-PERSIST-002 parallel commercial track

| ID | Requirement | Current State | Implementation Status | Verification Status | Tests / evidence | Residual Risk |
|---|---|---|---|---|---|---|
| MIG-PERSIST-002 | Make migration leases/checkpoints/events genuinely durable before building Migration Center UI | Runtime and Prisma persistence contracts aligned; same-file retries allowed; strict batch/job accounting enforced | IMPLEMENTED | INTEGRATION_VERIFIED | migration runtime/Prisma suites + structural boundary + full dependency-free regression | PostgreSQL migration/locking, queue/process-kill, object storage and real importer E2E remain |

Primary `NEXT_SCOPE_ID`: `CRM-PIPE-POSTGRES-005`

Migration-track `NEXT_SCOPE_ID`: `MIG-API-002`
