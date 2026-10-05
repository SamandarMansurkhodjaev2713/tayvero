
-- Additive R7/R8 migration. It does not remove or rewrite the legacy DealStage column.
CREATE TYPE "CrmPipelineStageType" AS ENUM ('OPEN', 'WON', 'LOST');
CREATE TYPE "CrmMigrationJobStatus" AS ENUM ('CREATED', 'VALIDATING', 'READY', 'IMPORTING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "CrmMigrationIssueSeverity" AS ENUM ('WARNING', 'ERROR');

CREATE TABLE "crm_pipeline" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "is_archived" BOOLEAN NOT NULL DEFAULT FALSE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_pipeline_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crm_pipeline_version_check" CHECK ("version" > 0),
  CONSTRAINT "crm_pipeline_default_not_archived_check" CHECK (NOT ("is_default" AND "is_archived"))
);
CREATE UNIQUE INDEX "crm_pipeline_workspace_id_id_key" ON "crm_pipeline"("workspace_id", "id");
CREATE UNIQUE INDEX "crm_pipeline_workspace_slug_key" ON "crm_pipeline"("workspace_id", "slug");
CREATE UNIQUE INDEX "crm_pipeline_one_default_per_workspace_key" ON "crm_pipeline"("workspace_id") WHERE "is_default" = TRUE AND "is_archived" = FALSE;
CREATE INDEX "crm_pipeline_workspace_archived_idx" ON "crm_pipeline"("workspace_id", "is_archived");

CREATE TABLE "crm_pipeline_stage" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "pipeline_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "stage_type" "CrmPipelineStageType" NOT NULL,
  "probability_bps" INTEGER NOT NULL,
  "color" TEXT,
  "allowed_from_stage_ids" JSONB NOT NULL DEFAULT '[]',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_pipeline_stage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crm_pipeline_stage_position_check" CHECK ("position" >= 0),
  CONSTRAINT "crm_pipeline_stage_version_check" CHECK ("version" > 0),
  CONSTRAINT "crm_pipeline_stage_probability_check" CHECK (
    ("stage_type" = 'OPEN' AND "probability_bps" BETWEEN 0 AND 9999) OR
    ("stage_type" = 'WON' AND "probability_bps" = 10000) OR
    ("stage_type" = 'LOST' AND "probability_bps" = 0)
  ),
  CONSTRAINT "crm_pipeline_stage_color_check" CHECK ("color" IS NULL OR "color" ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT "crm_pipeline_stage_pipeline_fkey" FOREIGN KEY ("workspace_id", "pipeline_id") REFERENCES "crm_pipeline"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "crm_pipeline_stage_workspace_pipeline_id_key" ON "crm_pipeline_stage"("workspace_id", "pipeline_id", "id");
CREATE UNIQUE INDEX "crm_pipeline_stage_workspace_pipeline_key_key" ON "crm_pipeline_stage"("workspace_id", "pipeline_id", "key");
CREATE UNIQUE INDEX "crm_pipeline_stage_workspace_pipeline_position_key" ON "crm_pipeline_stage"("workspace_id", "pipeline_id", "position");
CREATE INDEX "crm_pipeline_stage_type_idx" ON "crm_pipeline_stage"("workspace_id", "pipeline_id", "stage_type");

CREATE TABLE "crm_deal_pipeline_assignment" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "deal_id" TEXT NOT NULL,
  "pipeline_id" TEXT NOT NULL,
  "stage_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_deal_pipeline_assignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crm_deal_pipeline_assignment_version_check" CHECK ("version" > 0),
  CONSTRAINT "crm_deal_pipeline_assignment_pipeline_fkey" FOREIGN KEY ("workspace_id", "pipeline_id") REFERENCES "crm_pipeline"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "crm_deal_pipeline_assignment_stage_fkey" FOREIGN KEY ("workspace_id", "pipeline_id", "stage_id") REFERENCES "crm_pipeline_stage"("workspace_id", "pipeline_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "crm_deal_pipeline_assignment_workspace_deal_key" ON "crm_deal_pipeline_assignment"("workspace_id", "deal_id");
CREATE INDEX "crm_deal_pipeline_assignment_stage_idx" ON "crm_deal_pipeline_assignment"("workspace_id", "pipeline_id", "stage_id");
CREATE INDEX "crm_deal_pipeline_assignment_entered_idx" ON "crm_deal_pipeline_assignment"("workspace_id", "entered_at");

CREATE TABLE "crm_migration_job" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "source_format" TEXT NOT NULL,
  "source_filename" TEXT NOT NULL,
  "source_sha256" TEXT NOT NULL,
  "status" "CrmMigrationJobStatus" NOT NULL DEFAULT 'CREATED',
  "mapping" JSONB,
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "accepted_rows" INTEGER NOT NULL DEFAULT 0,
  "rejected_rows" INTEGER NOT NULL DEFAULT 0,
  "warning_count" INTEGER NOT NULL DEFAULT 0,
  "last_completed_batch" INTEGER NOT NULL DEFAULT -1,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_migration_job_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crm_migration_job_counts_check" CHECK ("total_rows" >= 0 AND "accepted_rows" >= 0 AND "rejected_rows" >= 0 AND "warning_count" >= 0),
  CONSTRAINT "crm_migration_job_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "crm_migration_job_workspace_id_key" ON "crm_migration_job"("workspace_id", "id");
CREATE UNIQUE INDEX "crm_migration_job_source_entity_key" ON "crm_migration_job"("workspace_id", "source_sha256", "entity_type");
CREATE INDEX "crm_migration_job_status_created_idx" ON "crm_migration_job"("workspace_id", "status", "created_at");

CREATE TABLE "crm_migration_batch" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "batch_index" INTEGER NOT NULL,
  "row_start" INTEGER NOT NULL,
  "row_end" INTEGER NOT NULL,
  "payload_sha256" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_migration_batch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crm_migration_batch_range_check" CHECK ("batch_index" >= 0 AND "row_start" >= 0 AND "row_end" >= "row_start" AND "attempt_count" >= 0),
  CONSTRAINT "crm_migration_batch_job_fkey" FOREIGN KEY ("workspace_id", "job_id") REFERENCES "crm_migration_job"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "crm_migration_batch_workspace_job_index_key" ON "crm_migration_batch"("workspace_id", "job_id", "batch_index");
CREATE INDEX "crm_migration_batch_status_idx" ON "crm_migration_batch"("workspace_id", "job_id", "status");

CREATE TABLE "crm_migration_issue" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "row_number" INTEGER NOT NULL,
  "severity" "CrmMigrationIssueSeverity" NOT NULL,
  "code" TEXT NOT NULL,
  "field" TEXT,
  "message" TEXT NOT NULL,
  "details" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_migration_issue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crm_migration_issue_row_check" CHECK ("row_number" > 0),
  CONSTRAINT "crm_migration_issue_job_fkey" FOREIGN KEY ("workspace_id", "job_id") REFERENCES "crm_migration_job"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "crm_migration_issue_job_severity_row_idx" ON "crm_migration_issue"("workspace_id", "job_id", "severity", "row_number");
