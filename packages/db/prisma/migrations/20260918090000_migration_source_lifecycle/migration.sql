ALTER TABLE "crm_migration_source"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "purged_at" TIMESTAMP(3),
  ADD COLUMN "delete_requested_by_id" TEXT,
  ADD COLUMN "delete_reason" TEXT,
  ADD CONSTRAINT "crm_source_purge_requires_tombstone" CHECK ("purged_at" IS NULL OR "deleted_at" IS NOT NULL),
  ADD CONSTRAINT "crm_source_version_positive" CHECK ("version" > 0);
CREATE TABLE "crm_migration_source_event" (
 "id" TEXT NOT NULL PRIMARY KEY, "workspace_id" TEXT NOT NULL, "source_id" TEXT NOT NULL,
 "actor_id" TEXT NOT NULL, "type" TEXT NOT NULL, "details" JSONB NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "crm_source_event_fk" FOREIGN KEY ("workspace_id", "source_id") REFERENCES "crm_migration_source"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "crm_source_event_source_created_idx" ON "crm_migration_source_event"("workspace_id", "source_id", "created_at");
