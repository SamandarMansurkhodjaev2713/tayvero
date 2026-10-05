-- CRM-PIPE-DUAL-WRITE-004 expand step.
-- Persist the explicit legacy DealStage -> configurable pipeline-stage bridge.
-- The legacy deal.stage column remains authoritative and is not removed here.
CREATE TABLE "crm_legacy_deal_stage_mapping" (
  "workspace_id" TEXT NOT NULL,
  "legacy_stage" "DealStage" NOT NULL,
  "pipeline_id" TEXT NOT NULL,
  "stage_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crm_legacy_deal_stage_mapping_pkey" PRIMARY KEY ("workspace_id", "legacy_stage"),
  CONSTRAINT "crm_legacy_deal_stage_mapping_version_check" CHECK ("version" > 0),
  CONSTRAINT "crm_legacy_deal_stage_mapping_pipeline_fkey"
    FOREIGN KEY ("workspace_id", "pipeline_id")
    REFERENCES "crm_pipeline"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "crm_legacy_deal_stage_mapping_stage_fkey"
    FOREIGN KEY ("workspace_id", "pipeline_id", "stage_id")
    REFERENCES "crm_pipeline_stage"("workspace_id", "pipeline_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "crm_legacy_deal_stage_mapping_target_idx"
  ON "crm_legacy_deal_stage_mapping"("workspace_id", "pipeline_id", "stage_id");
