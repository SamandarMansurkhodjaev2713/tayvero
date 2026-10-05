import assert from "node:assert/strict";
import test from "node:test";
import {
	parseDealPipelineDualWriteMode,
	planLegacyStageAssignmentSync,
} from "../src/deals/deal-pipeline-bridge-core.mjs";

const TENANT_ID = "tenant-dual-write-test";

const mapping = (overrides = {}) => ({
	workspaceId: TENANT_ID,
	legacyStage: "QUALIFIED_TO_BUY",
	pipelineId: "pipe",
	stageId: "qualified",
	pipeline: { id: "pipe", isDefault: true, isArchived: false },
	stage: { id: "qualified", pipelineId: "pipe", stageType: "OPEN" },
	...overrides,
});

function expectCode(fn, code) {
	assert.throws(fn, (error) => error?.code === code);
}

test("dual-write defaults off and accepts only explicit strict mode", () => {
	assert.equal(parseDealPipelineDualWriteMode(undefined), "off");
	assert.equal(parseDealPipelineDualWriteMode(" STRICT "), "strict");
	expectCode(
		() => parseDealPipelineDualWriteMode("best-effort"),
		"INVALID_DUAL_WRITE_MODE",
	);
});

test("plans assignment creation for a backfilled mapping target", () => {
	const changedAt = new Date("2026-09-05T12:00:00Z");
	const plan = planLegacyStageAssignmentSync({
		workspaceId: TENANT_ID,
		dealId: "deal-1",
		legacyStage: "QUALIFIED_TO_BUY",
		mapping: mapping(),
		assignment: null,
		changedAt,
	});
	assert.equal(plan.action, "create");
	assert.deepEqual(plan.data, {
		workspaceId: TENANT_ID,
		dealId: "deal-1",
		pipelineId: "pipe",
		stageId: "qualified",
		version: 1,
		enteredAt: changedAt,
	});
});

test("is idempotent when legacy and sidecar stages already agree", () => {
	const plan = planLegacyStageAssignmentSync({
		workspaceId: TENANT_ID,
		dealId: "deal-1",
		legacyStage: "QUALIFIED_TO_BUY",
		mapping: mapping(),
		assignment: {
			workspaceId: TENANT_ID,
			dealId: "deal-1",
			pipelineId: "pipe",
			stageId: "qualified",
			version: 3,
		},
		changedAt: new Date(),
	});
	assert.deepEqual(plan, { action: "none", expectedVersion: 3 });
});

test("plans optimistic assignment update when stages drift", () => {
	const plan = planLegacyStageAssignmentSync({
		workspaceId: TENANT_ID,
		dealId: "deal-1",
		legacyStage: "QUALIFIED_TO_BUY",
		mapping: mapping(),
		assignment: {
			workspaceId: TENANT_ID,
			dealId: "deal-1",
			pipelineId: "pipe",
			stageId: "old",
			version: 4,
		},
		changedAt: new Date("2026-09-05T12:00:00Z"),
	});
	assert.equal(plan.action, "update");
	assert.equal(plan.expectedVersion, 4);
	assert.equal(plan.data.version, 5);
});

test("fails closed for missing mapping, non-default mapping or semantic mismatch", () => {
	const base = {
		workspaceId: TENANT_ID,
		dealId: "deal-1",
		legacyStage: "QUALIFIED_TO_BUY",
		assignment: null,
		changedAt: new Date(),
	};
	expectCode(
		() => planLegacyStageAssignmentSync({ ...base, mapping: null }),
		"MAPPING_MISSING",
	);
	expectCode(
		() =>
			planLegacyStageAssignmentSync({
				...base,
				mapping: mapping({
					pipeline: { id: "pipe", isDefault: false, isArchived: false },
				}),
			}),
		"MAPPING_PIPELINE_NOT_ACTIVE_DEFAULT",
	);
	expectCode(
		() =>
			planLegacyStageAssignmentSync({
				...base,
				mapping: mapping({
					stage: { id: "qualified", pipelineId: "pipe", stageType: "LOST" },
				}),
			}),
		"MAPPING_STAGE_TYPE_MISMATCH",
	);
});
