# ADR 0016 — Source lifecycle and opt-in background imports

Date: 2026-09-18 (Asia/Tashkent). Status: IMPLEMENTED_EXTERNAL_VERIFICATION_REQUIRED.
Baseline: tayvero-master-2026-09-15.zip. No application rewrite; existing coordinator remains authoritative.

## Problem

Database metadata and encrypted files cannot be deleted in one ordinary database transaction. A failure
between unlink and acknowledgement must not lose the deletion intent or publish a missing file as usable.
Prepared imports already contain durable row receipts, but the browser was the only driver of batch progress.
A server worker must not silently change the authority, owner, plan, retry identity or cancellation semantics.

## Decision

Source deletion is a monotonic lifecycle: LIVE -> DELETION_REQUESTED -> PURGED. The source registry row and
application audit remain; no receipt, job or imported CRM record is deleted by source cleanup. Publish/prepare
and deletion lock the same source version. All job references, including terminal jobs, prevent source deletion.
This is intentionally narrower than a complete retention policy. There is no force-delete API.

The operator reviews a bounded, tenant-scoped plan bound to a fixed cutoff and exact candidate hash. Unused
registered sources age after 30 days; authenticated published orphans need both file mtime and encrypted
creation time older than 7 days. These are conservative operational defaults, not legal retention advice.
An orphan gets a unique tombstone in the registry BEFORE physical removal. A delayed upload cannot resurrect
that identity. A missing file after a persisted intent is an idempotent completion, including directory sync.
Corrupt, unkeyed and unsafe files are retained for review rather than deleted blindly.

Background scheduling is explicit per job and disabled at deployment by default. It stores the requesting
admin, queue version, next eligible/lease time and failure state on the existing job. The worker calls the SAME
executeBatch/coordinator/transactional row-receipt implementation used by the browser. It has no public HTTP
run-as-admin endpoint. It rechecks the stored requesting admin's membership each batch and preserves the original
job creator as CRM owner. An authenticated admin may pause a job; a claimed batch may finish, but a stale queue
acknowledgement cannot turn scheduling back on. Cancellation continues to use the job/transaction/lease fences.

A queue lease is 180 seconds; the existing batch lease is 120 seconds. A crash can be retried after lease expiry,
with the same persisted job, plan and receipts. Known transient errors have bounded backoff. Unknown errors
stop scheduling for review. Ambiguous external provider side effects are NOT in this import worker's scope.

## Rejected alternatives and consequences

- No unlink inside a retried SQL callback: filesystem side effects do not roll back with SQL.
- No destructive deletion of terminal job sources or receipts merely to free a quota.
- No second importer with a different idempotency scheme; no blanket whole-job replay.
- No permanent service identity allowed to import after the requesting admin loses authority.
- No cancellation of already-running database work on a visual pause click; pause drains one claimed batch.
- No heartbeat/provider health inference from a scheduling flag or nextAttemptAt timestamp.

Limits remain explicit: bounded inventory without exhaustive pagination, ignored temporary files, no object
storage adapter, no encrypted-source shredding/backups guarantee, no terminal-source retention, no supervised
worker deployed by this patch. Dedicated-workspace CRM and historical tenant findings remain unchanged.

## Evidence

Local Node tests exercise the actual crypto/filesystem, FIFO rejection, concurrent unlink, application logic and
query-contract double. They do not prove PostgreSQL isolation or production filesystem power-loss behavior.
Four additional real-PostgreSQL acceptance tests were written, NOT executed in the current environment.
See MASTER_REPORT and docs/runbooks/migration-source-lifecycle-and-worker.md before rollout.
