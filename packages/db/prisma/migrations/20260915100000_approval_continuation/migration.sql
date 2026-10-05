-- Expand-only: disabled until dedicated PostgreSQL + native Eve acceptance.
ALTER TABLE "agentRun" ADD COLUMN "approvalWaitStartedAt" TIMESTAMP(3),
  ADD COLUMN "approvalExecutionDeadlineAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "GovernedActionApproval_workspaceId_id_key" ON "GovernedActionApproval"("workspaceId", "id");
CREATE TABLE "GovernedActionContinuation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "approvalId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "rootSessionId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "callId" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "payloadDigest" TEXT NOT NULL,
  "nativeRequestId" TEXT,
  "nativeTurnId" TEXT,
  "nativeSequence" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'PREPARED',
  "version" INTEGER NOT NULL DEFAULT 0,
  "decision" TEXT,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "transportAdmittedAt" TIMESTAMP(3),
  "waitingAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "gac_approval_fk" FOREIGN KEY ("workspaceId", "approvalId") REFERENCES "GovernedActionApproval"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "gac_run_fk" FOREIGN KEY ("runId") REFERENCES "agentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GovernedActionContinuation_status_check" CHECK ("status" IN ('PREPARED','BOUND','READY','DISPATCHING','DELIVERED','COMPLETED','CANCELLED','RECONCILIATION_REQUIRED')),
  CONSTRAINT "GovernedActionContinuation_decision_check" CHECK ("decision" IS NULL OR "decision" IN ('approve','deny')),
  CONSTRAINT "GovernedActionContinuation_version_check" CHECK ("version" >= 0)
);
CREATE UNIQUE INDEX "gac_workspace_approval_key" ON "GovernedActionContinuation"("workspaceId","approvalId");
CREATE UNIQUE INDEX "gac_workspace_run_call_key" ON "GovernedActionContinuation"("workspaceId","runId","callId");
CREATE UNIQUE INDEX "gac_workspace_session_request_key" ON "GovernedActionContinuation"("workspaceId","sessionId","nativeRequestId");
CREATE INDEX "gac_pending_idx" ON "GovernedActionContinuation"("workspaceId","status","nextCheckAt");
CREATE INDEX "gac_lease_idx" ON "GovernedActionContinuation"("workspaceId","status","leaseExpiresAt");
