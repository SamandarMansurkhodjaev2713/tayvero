-- Expand only. Existing jobs have no source binding and remain operator-managed.
CREATE TABLE "crm_migration_source" (
 "id" TEXT PRIMARY KEY, "workspace_id" TEXT NOT NULL, "created_by_id" TEXT NOT NULL,
 "filename" TEXT NOT NULL, "mime_type" TEXT NOT NULL, "sha256" TEXT NOT NULL,
 "byte_length" INTEGER NOT NULL CHECK ("byte_length" > 0), "format" TEXT NOT NULL,
 "deleted_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "crm_migration_source_workspace_id_key" UNIQUE ("workspace_id", "id")
);
CREATE INDEX "crm_migration_source_lifecycle_idx" ON "crm_migration_source" ("workspace_id", "deleted_at", "created_at");
ALTER TABLE "crm_migration_job" ADD COLUMN "source_id" TEXT;
ALTER TABLE "crm_migration_job" ADD CONSTRAINT "crm_migration_job_workspace_id_source_id_fkey"
 FOREIGN KEY ("workspace_id", "source_id") REFERENCES "crm_migration_source" ("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "crm_migration_row_receipt" (
 "id" TEXT PRIMARY KEY, "workspace_id" TEXT NOT NULL, "job_id" TEXT NOT NULL,
 "row_number" INTEGER NOT NULL CHECK ("row_number" >= 2), "batch_index" INTEGER NOT NULL CHECK ("batch_index" >= 0),
 "fingerprint" TEXT NOT NULL, "entity_type" TEXT NOT NULL, "entity_id" TEXT,
 "status" TEXT NOT NULL CHECK ("status" IN ('CREATED','DUPLICATE','REJECTED','ROLLED_BACK')),
 "code" TEXT NOT NULL, "record_updated_at" TIMESTAMP(3), "rolled_back_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "crm_migration_receipt_row_key" UNIQUE ("workspace_id", "job_id", "row_number"),
 CONSTRAINT "crm_migration_row_receipt_workspace_id_job_id_fkey" FOREIGN KEY ("workspace_id", "job_id")
 REFERENCES "crm_migration_job" ("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "crm_migration_receipt_batch_idx" ON "crm_migration_row_receipt" ("workspace_id", "job_id", "batch_index");
