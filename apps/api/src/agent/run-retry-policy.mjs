/** Retrying a whole run creates new action keys. It is not replay of a single receipt. */
export function runRetryPolicy(run) {
    if (!['FAILED', 'CANCELLED'].includes(run?.status))
        return { allowed: false, code: 'RUN_NOT_RETRYABLE', reason: 'Only a failed or cancelled run can be retried.' };
    if (!Array.isArray(run.actions) || run.actionsTruncated)
        return { allowed: false, code: 'RETRY_HISTORY_INCOMPLETE', reason: 'Action history is incomplete. Review the run before starting anything again.' };
    if (typeof run.errorCode === 'string' && /(AMBIGUOUS|RECONCIL|AFTER_COMMIT|LEASE_EXPIRED_UNKNOWN)/.test(run.errorCode))
        return { allowed: false, code: 'RUN_REQUIRES_RECONCILIATION', reason: 'This run has an uncertain side effect. Reconcile it before retrying.' };
    for (const action of run.actions) {
        if (!Number.isSafeInteger(action.attemptCount) || action.attemptCount < 0 || action.attemptCount > 0 || action.externalId || ['RUNNING', 'SUCCEEDED'].includes(action.status) || !['PLANNED', 'FAILED', 'CANCELLED'].includes(action.status))
            return { allowed: false, code: 'RUN_REQUIRES_RECONCILIATION', reason: 'An action was attempted or completed. A whole-run retry could duplicate it; review receipts and outcomes first.' };
    }
    return { allowed: true, code: null, reason: null };
}
