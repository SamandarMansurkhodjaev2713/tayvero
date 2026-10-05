-- DropIndex
DROP INDEX "crm_migration_batch_lease_idx";

-- DropIndex
DROP INDEX "crm_pipeline_one_default_per_workspace_key";

-- RenameForeignKey
ALTER TABLE "crm_deal_pipeline_assignment" RENAME CONSTRAINT "crm_deal_pipeline_assignment_pipeline_fkey" TO "crm_deal_pipeline_assignment_workspace_id_pipeline_id_fkey";

-- RenameForeignKey
ALTER TABLE "crm_deal_pipeline_assignment" RENAME CONSTRAINT "crm_deal_pipeline_assignment_stage_fkey" TO "crm_deal_pipeline_assignment_workspace_id_pipeline_id_stag_fkey";

-- RenameForeignKey
ALTER TABLE "crm_legacy_deal_stage_mapping" RENAME CONSTRAINT "crm_legacy_deal_stage_mapping_pipeline_fkey" TO "crm_legacy_deal_stage_mapping_workspace_id_pipeline_id_fkey";

-- RenameForeignKey
ALTER TABLE "crm_legacy_deal_stage_mapping" RENAME CONSTRAINT "crm_legacy_deal_stage_mapping_stage_fkey" TO "crm_legacy_deal_stage_mapping_workspace_id_pipeline_id_sta_fkey";

-- RenameForeignKey
ALTER TABLE "crm_migration_batch" RENAME CONSTRAINT "crm_migration_batch_job_fkey" TO "crm_migration_batch_workspace_id_job_id_fkey";

-- RenameForeignKey
ALTER TABLE "crm_migration_event" RENAME CONSTRAINT "crm_migration_event_job_fkey" TO "crm_migration_event_workspace_id_job_id_fkey";

-- RenameForeignKey
ALTER TABLE "crm_migration_issue" RENAME CONSTRAINT "crm_migration_issue_job_fkey" TO "crm_migration_issue_workspace_id_job_id_fkey";

-- RenameForeignKey
ALTER TABLE "crm_pipeline_stage" RENAME CONSTRAINT "crm_pipeline_stage_pipeline_fkey" TO "crm_pipeline_stage_workspace_id_pipeline_id_fkey";

-- RenameIndex
ALTER INDEX "GovernedActionApproval_workspace_action_digest" RENAME TO "GovernedActionApproval_workspaceId_actionId_payloadDigest_idx";

-- RenameIndex
ALTER INDEX "GovernedActionApproval_workspace_status_expiry" RENAME TO "GovernedActionApproval_workspaceId_status_expiresAt_idx";

-- RenameIndex
ALTER INDEX "GovernedActionAuditEvent_workspace_action_occurred" RENAME TO "GovernedActionAuditEvent_workspaceId_actionId_occurredAt_idx";

-- RenameIndex
ALTER INDEX "GovernedActionAuditEvent_workspace_correlation" RENAME TO "GovernedActionAuditEvent_workspaceId_correlationId_idx";

-- RenameIndex
ALTER INDEX "GovernedActionAuditEvent_workspace_occurred" RENAME TO "GovernedActionAuditEvent_workspaceId_occurredAt_idx";

-- RenameIndex
ALTER INDEX "GovernedActionReceipt_workspace_action_created" RENAME TO "GovernedActionReceipt_workspaceId_actionId_createdAt_idx";

-- RenameIndex
ALTER INDEX "GovernedActionReceipt_workspace_action_key" RENAME TO "GovernedActionReceipt_workspaceId_actionId_idempotencyKey_key";

-- RenameIndex
ALTER INDEX "GovernedActionReceipt_workspace_status_lease" RENAME TO "GovernedActionReceipt_workspaceId_status_leaseExpiresAt_idx";
