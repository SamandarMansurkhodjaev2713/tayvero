export { PipelineDomainError } from "./errors.mjs";
export {
	compileLegacyStageMapping,
	LEGACY_DEAL_STAGES,
	parseLegacyDealStage,
	reconcileLegacyStageAssignments,
} from "./legacy-stage-bridge.mjs";
export {
	buildLegacyStageMigrationPlan,
	calculatePipelineAnalytics,
	planDealStageTransition,
} from "./pipeline.mjs";
export { PipelineDefinitionJsonSchema } from "./schemas.mjs";
export {
	normalizePipelineSlug,
	parseAssignment,
	parsePipelineDefinition,
	RESERVED_STAGE_KEY_PREFIX,
} from "./validation.mjs";
