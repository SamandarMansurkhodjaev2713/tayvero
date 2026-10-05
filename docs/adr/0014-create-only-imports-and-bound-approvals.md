# ADR 0014 — durable create-only import and one-shot consent

Date: 2026-09-14. Status: IMPLEMENTED_EXTERNAL_VERIFICATION_REQUIRED.
Local contracts are exercised; this ADR does not certify PostgreSQL or the application build.

## Decisions

Migration Center is a dedicated-workspace owner/admin surface. The browser submits source bytes,
column mapping and command identity, never tenant/owner selectors or accepted CRM rows. UTF-8 CSV/TSV
is limited to 512 KiB, 5,000 rows and finite 50-row transactions. Server-side source bytes are
AES-256-GCM encrypted on a persistent POSIX volume; source registry and immutable plan live in PostgreSQL.
Only contact/company creation is enabled. Exact duplicates are skipped, ambiguous matches rejected,
never merged. Deals, associations and custom fields require later scoped implementations.

An immutable row fingerprint, deterministic CRM ID, and unique tenant/job/row receipt prevent double
creation after a committed batch loses its acknowledgement. CRM rows and their receipts commit in one
serializable transaction; batch acknowledgement is a separate retriable step. A no-change job write
serializes cancellation against writes; lease/version checks fence obsolete workers. Real PostgreSQL
concurrency still must prove these properties. Rollback archives only unchanged, unreferenced rows owned
by this import, never deletes records or undoes unrelated human work. Failed/cancelled partial imports
may be archived after active leases settle. Row reconciliation is accounting, not proof of business ROI.

Approval requests can originate only in the governed executor after authorization and policy evaluation.
A binding is tenant + requesting principal + action + execution identity + exact validated digest.
The server derives the human principal of an agent run from its immutable version and current membership.
Full safe preview, a distinct current owner/admin, optimistic version and expiry are required. Sensitive
or truncated previews cannot be approved. Consent is consumed once; requester and approver authority
are rechecked. Deadlines use the service clock again immediately before transition. Audit commits with
state. Legacy approvals remain readable but are not made trusted by adding metadata retrospectively.

Approval does NOT restart an entire agent run, dispatch a provider call, or synthesize a new idempotency
key. Durable orchestration that pauses/resumes the exact action is a separate unfinished scope.
The current production run bridge remains RUNNING-only; an approval queue is not a claim that this
orchestration exists. Keep deployment rules requiring approval disabled until the chosen agent flow
has an explicit continuation implementation and passing integration tests.

## Compatibility and rollout

Two expand-only migrations add sources/receipts and approval bindings. Legacy Deal.stage remains
authoritative. No destructive cutover is performed. Defaults leave Migration Center, CRM import writes
and bound approvals off. Apply all migrations to a disposable test DB first. Once enabled, retain tables,
source files and decryption keys on rollback; turn flags off instead of dropping historical evidence.
Core CRM remains a single dedicated workspace, not shared-database SaaS.

## Metrics / privacy

The operations console reads deployed team agents only; private drafts are excluded. Counts and recorded
micro-USD costs are bounded and accompanied by coverage. Provider health, money/time saved and outcomes
are not invented. CRM AgentAction.requestHash differs from the governed digest: receipts link through
server-written metadata.operationDigest AND action kind. Missing legacy links are explicitly unknown.

## Review outcomes

Data integrity: job/batch/row receipts and two-phase acknowledgement retained; no blind CRM retries.
Security: session+current membership, server-owned context, bounded raw bodies and exact snapshots.
Concurrency: late leases, cancellation, replay and stale decisions tested locally, with a real DB gate.
UX: preview before writes, explicit loop stopping versus cancellation, archive confirmation, visible
unknown metrics, theme reuse and three-language operator screens.
Release honesty: local contracts are separated from compilation, actual DB and authenticated E2E.
