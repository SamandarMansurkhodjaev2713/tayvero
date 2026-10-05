-- Additive governed agent action execution state.
CREATE TABLE IF NOT EXISTS "GovernedActionReceipt" (
  "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "actionId" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "payloadDigest" TEXT NOT NULL, "status" TEXT NOT NULL, "leaseTokenHash" TEXT, "leaseExpiresAt" TIMESTAMP(3), "attemptCount" INTEGER NOT NULL DEFAULT 0, "resultJson" JSONB, "errorCode" TEXT, "completedAt" TIMESTAMP(3), "version" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "GovernedActionReceipt_workspace_action_key" ON "GovernedActionReceipt"("workspaceId","actionId","idempotencyKey");
CREATE INDEX IF NOT EXISTS "GovernedActionReceipt_workspace_status_lease" ON "GovernedActionReceipt"("workspaceId","status","leaseExpiresAt");
CREATE INDEX IF NOT EXISTS "GovernedActionReceipt_workspace_action_created" ON "GovernedActionReceipt"("workspaceId","actionId","createdAt");
CREATE TABLE IF NOT EXISTS "GovernedActionApproval" (
  "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "actionId" TEXT NOT NULL, "payloadDigest" TEXT NOT NULL, "status" TEXT NOT NULL, "requestedById" TEXT NOT NULL, "approvedById" TEXT, "consumedById" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3), "version" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "GovernedActionApproval_workspace_status_expiry" ON "GovernedActionApproval"("workspaceId","status","expiresAt");
CREATE INDEX IF NOT EXISTS "GovernedActionApproval_workspace_action_digest" ON "GovernedActionApproval"("workspaceId","actionId","payloadDigest");
CREATE TABLE IF NOT EXISTS "GovernedActionAuditEvent" (
  "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "actionId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "requestId" TEXT NOT NULL, "correlationId" TEXT NOT NULL, "eventType" TEXT NOT NULL, "payloadDigest" TEXT, "detailsJson" JSONB NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "GovernedActionAuditEvent_workspace_occurred" ON "GovernedActionAuditEvent"("workspaceId","occurredAt");
CREATE INDEX IF NOT EXISTS "GovernedActionAuditEvent_workspace_action_occurred" ON "GovernedActionAuditEvent"("workspaceId","actionId","occurredAt");
CREATE INDEX IF NOT EXISTS "GovernedActionAuditEvent_workspace_correlation" ON "GovernedActionAuditEvent"("workspaceId","correlationId");
