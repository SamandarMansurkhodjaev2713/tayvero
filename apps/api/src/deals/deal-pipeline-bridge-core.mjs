const MODES = new Set(["off", "strict"]);
const LEGACY_STAGE_TYPES = Object.freeze({
	DEMO_BOOKED: "OPEN",
	QUALIFIED_TO_BUY: "OPEN",
	DECISION_MAKER_BOUGHT_IN: "OPEN",
	CONTRACT_SENT: "OPEN",
	UNQUALIFIED_TO_BUY: "LOST",
	CLOSED_WON: "WON",
	CLOSED_LOST: "LOST",
});

function fail(code, message, details = {}) {
	const error = new Error(message);
	error.code = code;
	error.details = Object.freeze({ ...details });
	throw error;
}

export function parseDealPipelineDualWriteMode(value) {
	const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (normalized === "") return "off";
	if (!MODES.has(normalized)) {
		fail("INVALID_DUAL_WRITE_MODE", "CRM_PIPELINE_DUAL_WRITE_MODE must be off or strict");
	}
	return normalized;
}

export function planLegacyStageAssignmentSync(input) {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		fail("INVALID_SYNC_INPUT", "Deal pipeline sync input must be an object");
	}
	const { workspaceId, dealId, legacyStage, mapping, assignment } = input;
	if (typeof workspaceId !== "string" || workspaceId.trim() === "") fail("INVALID_WORKSPACE", "workspaceId is required");
	if (typeof dealId !== "string" || dealId.trim() === "") fail("INVALID_DEAL", "dealId is required");
	const expectedType = LEGACY_STAGE_TYPES[legacyStage];
	if (!expectedType) fail("INVALID_LEGACY_STAGE", "Unsupported legacy DealStage", { legacyStage });
	if (!mapping) fail("MAPPING_MISSING", "Legacy DealStage mapping is missing", { legacyStage });
	if (mapping.workspaceId !== workspaceId || mapping.legacyStage !== legacyStage) {
		fail("MAPPING_SCOPE_MISMATCH", "Legacy stage mapping does not match the requested workspace/stage");
	}
	if (!mapping.pipeline || mapping.pipeline.isArchived || !mapping.pipeline.isDefault) {
		fail("MAPPING_PIPELINE_NOT_ACTIVE_DEFAULT", "Legacy stage mapping must target the active default pipeline");
	}
	if (!mapping.stage || mapping.stage.pipelineId !== mapping.pipelineId || mapping.stage.id !== mapping.stageId) {
		fail("MAPPING_STAGE_MISMATCH", "Legacy stage mapping target is internally inconsistent");
	}
	if (mapping.stage.stageType !== expectedType) {
		fail("MAPPING_STAGE_TYPE_MISMATCH", "Legacy stage mapping changes deal outcome semantics", {
			legacyStage,
			expectedType,
			actualType: mapping.stage.stageType,
		});
	}
	const changedAt = input.changedAt instanceof Date ? input.changedAt : new Date(input.changedAt);
	if (Number.isNaN(changedAt.getTime())) fail("INVALID_CHANGED_AT", "changedAt must be a valid date");
	if (!assignment) {
		return Object.freeze({
			action: "create",
			data: Object.freeze({ workspaceId, dealId, pipelineId: mapping.pipelineId, stageId: mapping.stageId, version: 1, enteredAt: changedAt }),
		});
	}
	if (assignment.workspaceId !== workspaceId || assignment.dealId !== dealId) {
		fail("ASSIGNMENT_SCOPE_MISMATCH", "Existing assignment does not match the deal/workspace");
	}
	if (assignment.pipelineId === mapping.pipelineId && assignment.stageId === mapping.stageId) {
		return Object.freeze({ action: "none", expectedVersion: assignment.version });
	}
	if (!Number.isSafeInteger(assignment.version) || assignment.version < 1) {
		fail("INVALID_ASSIGNMENT_VERSION", "Existing assignment version is invalid");
	}
	return Object.freeze({
		action: "update",
		expectedVersion: assignment.version,
		data: Object.freeze({ pipelineId: mapping.pipelineId, stageId: mapping.stageId, version: assignment.version + 1, enteredAt: changedAt }),
	});
}
