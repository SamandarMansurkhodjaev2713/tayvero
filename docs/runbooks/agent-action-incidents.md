# Agent action incident runbook

1. Identify `tenantId`, `actionId`, `requestId`, `correlationId` and idempotency key from structured audit metadata. Never copy secret-bearing payloads into tickets.
2. Pause the deployment or action manifest when unauthorized, repeated or malformed execution is suspected.
3. Inspect receipt state before retrying. A `SUCCEEDED` receipt is replayed; an active lease must not be bypassed.
4. Revoke pending approvals if the manifest, permissions or source data changed.
5. Retry only errors classified as transient and only for idempotent actions.
6. Reconcile the external side effect before releasing a stale lease.
7. Record remediation and add a regression test before re-enabling the action.
