# ADR-0007: Durable agent action state

## Decision
Use tenant-scoped database records for action receipts, approvals and audit events. Receipt acquisition uses a unique `(workspaceId, actionId, idempotencyKey)` key and a hashed lease token. Approval consumption is an atomic conditional update bound to tenant, action and payload digest.

## Operational consequences
Workers may recover expired leases only after reconciling the external side effect. Approval records are single-use. Audit payloads are redacted before persistence. The migration is additive; cleanup of old execution state is deferred until reconciliation and rollback windows close.
