ALTER TABLE "crm_migration_job"
 ADD COLUMN "background_enabled" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "background_requested_by_id" TEXT,
 ADD COLUMN "background_version" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "background_next_attempt_at" TIMESTAMP(3),
 ADD COLUMN "background_failure_count" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "background_last_error_code" TEXT,
 ADD CONSTRAINT "crm_background_consent_required" CHECK (NOT "background_enabled" OR "background_requested_by_id" IS NOT NULL),
 ADD CONSTRAINT "crm_background_counters_positive" CHECK ("background_version" >= 0 AND "background_failure_count" >= 0);
CREATE INDEX "crm_migration_background_due_idx" ON "crm_migration_job"("workspace_id", "background_enabled", "background_next_attempt_at");
