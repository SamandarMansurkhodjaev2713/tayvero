-- Additive migration-runtime durability fields. No source CRM records are rewritten.
ALTER TABLE "crm_migration_batch"
  ADD COLUMN "row_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "imported_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rejected_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lease_owner" TEXT,
  ADD COLUMN "lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "crm_migration_batch"
  ADD CONSTRAINT "crm_migration_batch_runtime_counts_check"
    CHECK ("row_count" >= 0 AND "imported_count" >= 0 AND "rejected_count" >= 0),
  ADD CONSTRAINT "crm_migration_batch_runtime_version_check"
    CHECK ("version" > 0),
  ADD CONSTRAINT "crm_migration_batch_lease_check"
    CHECK (("lease_owner" IS NULL) = ("lease_expires_at" IS NULL));

CREATE INDEX "crm_migration_batch_lease_idx"
  ON "crm_migration_batch"("workspace_id", "job_id", "status", "lease_expires_at");

CREATE TABLE "crm_migration_event" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actor_id" TEXT,
  "batch_index" INTEGER,
  "details" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_migration_event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crm_migration_event_batch_index_check" CHECK ("batch_index" IS NULL OR "batch_index" >= 0),
  CONSTRAINT "crm_migration_event_job_fkey" FOREIGN KEY ("workspace_id", "job_id") REFERENCES "crm_migration_job"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "crm_migration_event_job_created_idx"
  ON "crm_migration_event"("workspace_id", "job_id", "created_at");
CREATE INDEX "crm_migration_event_type_created_idx"
  ON "crm_migration_event"("workspace_id", "type", "created_at");

-- A source file hash is evidence identity, not import intent. The same file may be
-- retried after cancellation/failure or imported with a different validated mapping.
DROP INDEX IF EXISTS "crm_migration_job_source_entity_key";
CREATE INDEX "crm_migration_job_source_entity_created_idx"
  ON "crm_migration_job"("workspace_id", "source_sha256", "entity_type", "created_at");
