export function executionBudgetExpired(run: { status: string; sessionId?: string | null; startedAt?: Date | string | null; cancelRequestedAt?: Date | null; approvalExecutionDeadlineAt?: Date | string | null } | null,
  options: { now?: Date; timeoutMs: number; continuationEnabled?: boolean }): boolean;
