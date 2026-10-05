-- Additive persistence for idempotent configurable-pipeline API commands.
-- The legacy DealStage column remains untouched during the expand phase.
CREATE TABLE "crm_pipeline_command_receipt" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "result_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_pipeline_command_receipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crm_pipeline_command_receipt_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "crm_pipeline_command_receipt_action_check" CHECK (char_length("action") BETWEEN 1 AND 120),
  CONSTRAINT "crm_pipeline_command_receipt_key_check" CHECK (char_length("idempotency_key") BETWEEN 8 AND 200)
);

CREATE UNIQUE INDEX "crm_pipeline_command_receipt_workspace_action_key"
  ON "crm_pipeline_command_receipt"("workspace_id", "action", "idempotency_key");
CREATE INDEX "crm_pipeline_command_receipt_workspace_created_idx"
  ON "crm_pipeline_command_receipt"("workspace_id", "created_at");

CREATE TABLE "crm_pipeline_audit_event" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "entity_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_pipeline_audit_event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "crm_pipeline_audit_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "crm_pipeline_audit_outcome_check" CHECK ("outcome" IN ('SUCCESS'))
);

CREATE INDEX "crm_pipeline_audit_workspace_created_idx"
  ON "crm_pipeline_audit_event"("workspace_id", "created_at");
CREATE INDEX "crm_pipeline_audit_entity_created_idx"
  ON "crm_pipeline_audit_event"("workspace_id", "entity_id", "created_at");
CREATE INDEX "crm_pipeline_audit_request_idx"
  ON "crm_pipeline_audit_event"("request_id");
