
# Migration worker recovery

1. Stop new claims for the affected job.
2. Inspect persisted job status, batch status, lease owner and lease expiration.
3. Do not manually mark a `RUNNING` batch complete without verifying importer idempotency records.
4. Wait for lease expiration or explicitly revoke it through an audited administrative operation.
5. Replay the same batch with the same digest-derived idempotency key.
6. Reconcile imported, rejected and source counts after every recovery.
7. Move poison batches to `FAILED` only after the configured bounded attempts.
8. Export the error report before any rollback.
9. Rollback imported records only with source-job ownership markers and a separate approval.
