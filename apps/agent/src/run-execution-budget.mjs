/** Pure timeout predicate. Must be called on a freshly locked row at the FAILED transition.
 * startedAt is immutable history; only the budget deadline pauses for verified human waiting.
 */
export function executionBudgetExpired(run, { now = new Date(), timeoutMs, continuationEnabled = false } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(new Date(now).getTime()))
    throw new TypeError("Invalid execution timeout configuration");
  if (!run || run.status !== "RUNNING" || !run.sessionId || run.cancelRequestedAt) return false;
  const started = run.startedAt && new Date(run.startedAt).getTime();
  if (!Number.isFinite(started)) return false;
  const deadline = continuationEnabled && run.approvalExecutionDeadlineAt
    ? new Date(run.approvalExecutionDeadlineAt).getTime() : started + timeoutMs;
  if (!Number.isFinite(deadline)) throw new TypeError("Invalid saved execution deadline");
  return deadline < new Date(now).getTime();
}
