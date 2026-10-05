# Governed action receipt recovery

1. Never delete an `IN_PROGRESS` receipt solely because its lease expired.
2. Inspect the external provider using the action's idempotency key or correlation identifier.
3. When the side effect completed, reconcile the receipt to `SUCCEEDED` with the validated result.
4. When no side effect occurred, retry through the normal executor; do not call the provider manually.
5. For an ambiguous side effect, quarantine the action and require operator review.
6. Preserve audit events and record the recovery decision.
