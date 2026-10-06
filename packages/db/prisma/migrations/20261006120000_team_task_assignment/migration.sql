-- Assignment is separate from authorship. Removed users remain unassigned.
ALTER TABLE "activity"
 ADD COLUMN "assigneeId" TEXT,
 ADD COLUMN "taskVersion" INTEGER NOT NULL DEFAULT 0,
 ADD CONSTRAINT "activity_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 ADD CONSTRAINT "activity_task_version_nonnegative" CHECK ("taskVersion" >= 0);

UPDATE "activity" AS a SET "assigneeId" = a."createdById"
 FROM "member" AS m
 WHERE a."type" = 'TASK'
 AND m."userId" = a."createdById"
 AND m."organizationId" = 'workspace'
 AND m."role" IN ('owner', 'admin', 'member');

CREATE INDEX "activity_assigneeId_completedAt_dueAt_idx" ON "activity"("assigneeId", "completedAt", "dueAt");

CREATE TABLE "taskAuditEvent" (
 "id" TEXT NOT NULL,
 "workspaceId" TEXT NOT NULL,
 "taskId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL,
 "actorName" TEXT NOT NULL,
 "action" TEXT NOT NULL,
 "before" JSONB,
 "after" JSONB NOT NULL,
 "taskVersion" INTEGER NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "taskAuditEvent_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "taskAuditEvent_version_nonnegative" CHECK ("taskVersion" >= 0),
 CONSTRAINT "taskAuditEvent_action_valid" CHECK ("action" IN ('CREATED', 'UPDATED', 'COMPLETED', 'REOPENED'))
);
CREATE INDEX "taskAuditEvent_workspaceId_taskId_createdAt_idx" ON "taskAuditEvent"("workspaceId", "taskId", "createdAt");
