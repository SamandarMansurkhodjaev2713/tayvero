-- Expand-only: historical approvals stay readable but cannot be newly approved by the lifecycle API.
ALTER TABLE "GovernedActionApproval"
  ADD COLUMN "bindingVersion" INTEGER,
  ADD COLUMN "requestKey" TEXT,
  ADD COLUMN "executionKeyHash" TEXT,
  ADD COLUMN "requesterUserId" TEXT,
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "correlationId" TEXT,
  ADD COLUMN "manifestVersion" TEXT,
  ADD COLUMN "snapshotJson" JSONB,
  ADD COLUMN "runId" TEXT,
  ADD COLUMN "decidedById" TEXT,
  ADD COLUMN "decidedAt" TIMESTAMP(3),
  ADD COLUMN "decisionReason" TEXT;
CREATE UNIQUE INDEX "GovernedActionApproval_workspaceId_requestKey_key" ON "GovernedActionApproval"("workspaceId", "requestKey");
CREATE INDEX "GovernedActionApproval_workspaceId_runId_idx" ON "GovernedActionApproval"("workspaceId", "runId");
ALTER TABLE "GovernedActionApproval" ADD CONSTRAINT "GovernedActionApproval_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GovernedActionApproval" ADD CONSTRAINT "GovernedActionApproval_bound_v1_check" CHECK (
  "bindingVersion" IS NULL OR (
    "bindingVersion" = 1 AND "requestKey" IS NOT NULL AND "executionKeyHash" IS NOT NULL AND
    "requestId" IS NOT NULL AND "correlationId" IS NOT NULL AND "manifestVersion" IS NOT NULL AND
    "requesterUserId" IS NOT NULL AND "snapshotJson" IS NOT NULL AND
    "status" IN ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED','CONSUMED') AND
    "expiresAt" > "createdAt" AND "version" >= 0
  )
);

CREATE INDEX "GovernedActionReceipt_workspaceId_payloadDigest_idx" ON "GovernedActionReceipt"("workspaceId", "payloadDigest");
