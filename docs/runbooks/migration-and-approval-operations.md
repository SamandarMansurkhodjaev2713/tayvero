# Migration and approval deployment / incident runbook

Checkpoint: 2026-09-14. NOT a production approval. Work on a disposable DB first.

## Acceptance commands

With Bun 1.3.12, the locked dependencies and a separate loopback PostgreSQL available:

```sh
bun install --frozen-lockfile
bun run gate:pipeline-postgres
bun run gate:operations-postgres
bun run quality:gate
```

Provide TEST_DATABASE_URL explicitly, ending in a safe `_test` database name, different from DATABASE_URL.
Neither gate substitutes the application DB. Remote test servers require ALLOW_REMOTE_TEST_DATABASE=1;
operators must establish true isolation. Reset is never automatic. No commands above require or perform
a customer production reset. CI supplies an ephemeral Postgres service, but CI has not run in this session.
The operations spec uses actual Prisma and tests source persistence, competing commands/workers,
row receipts/transaction rollback, tenant-composite FK/uniqueness, safe archive and one-shot consent.
Passing it still does not verify authenticated Nest/tRPC/Next, proxies, providers or load.

## Migration Center

Routes: `/<slug>/settings/migrations`; authenticated `migrations.*` procedures.
Role: current owner/admin only, interactive session, configured dedicated workspace.

1. Mount a durable local POSIX volume owned by the API UID, private directory permissions.
   Never use an ephemeral container/serverless disk. Multi-host deployments must not use independent
   local volumes for a shared registry. Source-store object-storage support is not implemented.
2. Supply MIGRATION_SOURCE_ROOT, MIGRATION_SOURCE_KEYS_JSON and MIGRATION_SOURCE_ACTIVE_KEY via a
   secret manager. Each key is canonical base64 for 32 random bytes; this is not the credential-vault
   key ring. Keep old keys while files reference them; a new active key does not re-encrypt old files.
3. After DB acceptance, enable MIGRATION_CENTER_ENABLED=1 in staging and restart the API.
   Keep MIGRATION_EXECUTION_ENABLED=0 for upload/preview/mapping checks.
4. Enable MIGRATION_EXECUTION_ENABLED=1 only after actual DB and authenticated write/recovery tests.
   Both gates are server-side. No client toggle can grant writes.
5. Test a representative CSV with invalid rows and duplicates; verify counts against the source.
   Then test cancellation, page closing, source reload and repeated requests before using customer data.

Supported: UTF-8 CSV/TSV, 512 KiB, 5,000 rows. Contacts: firstName/lastName/email/UZ phone/title;
companies: name/domain/email/UZ phone. Record owner is the preparing administrator. No automatic merge,
update, deal import, association import, custom fields or XLSX. Database dedupe happens at execution,
so a preview is not a promise of a fixed created count. Sources capped at 20 active; list shows the most
recent 25 jobs. Larger volumes/history/retention are unfinished, not merely missing credentials.

Processing uses finite API batches driven by the open page. Closing/stopping the page stops new requests;
a batch already sent may commit. State survives, but there is no autonomous background import scheduler.
Reopen the saved job and continue the same job ID. Cancellation is persistent and stops future batches,
not a reversal. Do not create a new job to recover the same in-flight intent.

A receipt may exist before the batch acknowledgement: repeat the same job; receipts suppress duplicate
CRM writes. A lease may require waiting for expiry (120 seconds) before another worker can claim it.
A revoked administrator or removed planned owner blocks additional writes. Investigate state rather
than changing counters by hand. Report accounting mismatch must not be marked COMPLETED manually.

Rollback is preview first, then exact job-ID confirmation per page of up to 50 records. It archives
only unchanged IMPORT rows with no downstream references; existing duplicates, edited or linked rows
are skipped. It never issues customer DELETEs. Archived rows remain in the accounting history.

Unused registered sources may be tombstoned and removed idempotently. Sources referenced by any job
are retained for replay/audit. A crash between encrypted publication and registry commit can leave an
encrypted orphan. There is no automatic orphan janitor in this release. Before manual cleanup: disable
uploads, settle in-flight requests, reconcile opaque source IDs in registry against private volume,
back up the DB/volume/key ring, and use an explicit reviewed inventory. Never delete by filename or age
alone. Source deletion does not substitute a GDPR/legal retention policy.

## Approvals and policy

Routes: `/<slug>/operations`, `operations.approvals` and `operations.decideApproval`.
Apply 20260914100000_bound_action_approvals, then enable AGENT_APPROVAL_CENTER_ENABLED=1 consistently
in staging API and agent processes. Changing environment requires restart. Have two distinct current
owner/admin users; a requesting human cannot approve their own action, including via an agent-run ID.

AGENT_ACTION_POLICIES_JSON is empty or a JSON object of exact action IDs to ALLOW, DENY or
REQUIRE_APPROVAL. It cannot add tools beyond the immutable deployed manifest and authorizer.
Empty inherits that bounded manifest; malformed nonempty JSON fails closed. AGENT_ACTION_READ_ONLY=1
denies all mutating actions. HIGH/CRITICAL manifests still require consent regardless of an ALLOW rule.

Requests come only from the executor. UI/HTTP do not expose a create-approval or raw-execute endpoint.
Review exact payload, agent/run, requester, digest, version and deadline. If preview is redacted or
truncated, approval is unavailable: implement a bounded safe action preview rather than bypass it.
The service rechecks authority and current expiry before consuming one consent. Expired display state
is computed even without a sweeper; explicit expiration/decision creates an audit event.

Approve/reject/cancel records a decision only. No new run is started. Whole-run retry remains blocked
where it can duplicate side effects. A production continuation adapter for the same action, persisted
wait state and safe wakeup is NOT finished; do not enable per-action REQUIRE_APPROVAL on a deployed
workflow and assume the console automatically resumes it.

AMBIGUOUS is not FAILED: do not retry an unknown external outcome with a new key. Verify the external
provider outcome and reconcile the existing receipt under an incident procedure. The console deliberately
has no unsafe blanket Retry button.

## Authenticated acceptance and operational checks still required

Exercise owner/admin/member/anonymous/revoked-session access and API-key rejection. Test tRPC batching,
raw-body guard behind the real proxy, upload 413/415/408/429, disconnected requests, second-admin race,
expired dialog snapshot, locale preference, keyboard focus, mobile tables, all theme modes. The local
Node HTTP test proves the guard on a loopback server, not Nest integration.
Configure reverse-proxy per-identity limits, TLS and bounded request timeouts. Max 8 simultaneous operator
bodies/requests and 800 KiB body limit are not a complete distributed rate-limit or DoS defence.
Back up and restore DB, source volume and keys together; no live backup/restore qualification occurred.
