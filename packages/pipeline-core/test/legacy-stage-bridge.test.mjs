import assert from "node:assert/strict";
import test from "node:test";
import { PipelineDomainError, compileLegacyStageMapping, reconcileLegacyStageAssignments } from "../src/index.mjs";

const TENANT_ID = "tenant-legacy-bridge-test";

const pipeline = () => ({
	id: "pipeline-a",
	tenantId: TENANT_ID,
	name: "Legacy compatible",
	slug: "legacy-compatible",
	isDefault: true,
	isArchived: false,
	version: 1,
	stages: [
		{ id: "demo", key: "demo", name: "Demo", position: 0, type: "OPEN", probabilityBps: 1000, color: null, allowedFromStageIds: [] },
		{ id: "qualified", key: "qualified", name: "Qualified", position: 1, type: "OPEN", probabilityBps: 4000, color: null, allowedFromStageIds: [] },
		{ id: "decision", key: "decision", name: "Decision", position: 2, type: "OPEN", probabilityBps: 7000, color: null, allowedFromStageIds: [] },
		{ id: "contract", key: "contract", name: "Contract", position: 3, type: "OPEN", probabilityBps: 9000, color: null, allowedFromStageIds: [] },
		{ id: "won", key: "won", name: "Won", position: 4, type: "WON", probabilityBps: 10000, color: null, allowedFromStageIds: [] },
		{ id: "lost", key: "lost", name: "Lost", position: 5, type: "LOST", probabilityBps: 0, color: null, allowedFromStageIds: [] },
	],
});
const mapping = () => ({
	DEMO_BOOKED: "demo",
	QUALIFIED_TO_BUY: "qualified",
	DECISION_MAKER_BOUGHT_IN: "decision",
	CONTRACT_SENT: "contract",
	CLOSED_WON: "won",
	CLOSED_LOST: "lost",
	UNQUALIFIED_TO_BUY: "lost",
});
function expectCode(fn, code) {
	assert.throws(fn, (error) => error instanceof PipelineDomainError && error.code === code);
}

test("compiles a complete deterministic legacy stage map", () => {
	const first = compileLegacyStageMapping({ pipeline: pipeline(), mapping: mapping() });
	const second = compileLegacyStageMapping({ pipeline: pipeline(), mapping: mapping() });
	assert.equal(first.count, 7);
	assert.equal(first.digest, second.digest);
	assert.equal(first.rows.find((row) => row.legacyStage === "CLOSED_WON").stageId, "won");
});

test("requires every legacy stage to be mapped", () => {
	const partial = mapping();
	delete partial.CONTRACT_SENT;
	expectCode(() => compileLegacyStageMapping({ pipeline: pipeline(), mapping: partial }), "UNMAPPED_LEGACY_STAGE");
});

test("rejects semantic mismatch between legacy outcome and pipeline stage type", () => {
	const invalid = mapping();
	invalid.CLOSED_WON = "qualified";
	expectCode(() => compileLegacyStageMapping({ pipeline: pipeline(), mapping: invalid }), "LEGACY_STAGE_TYPE_MISMATCH");
});

test("reconciliation reports missing, wrong and orphan assignments deterministically", () => {
	const result = reconcileLegacyStageAssignments({
		pipeline: pipeline(),
		mapping: mapping(),
		deals: [
			{ id: "d1", tenantId: TENANT_ID, legacyStage: "DEMO_BOOKED" },
			{ id: "d2", tenantId: TENANT_ID, legacyStage: "CLOSED_WON" },
			{ id: "d3", tenantId: TENANT_ID, legacyStage: "CLOSED_LOST" },
		],
		assignments: [
			{ tenantId: TENANT_ID, dealId: "d1", pipelineId: "pipeline-a", stageId: "demo", version: 1 },
			{ tenantId: TENANT_ID, dealId: "d2", pipelineId: "pipeline-a", stageId: "lost", version: 1 },
			{ tenantId: TENANT_ID, dealId: "orphan", pipelineId: "pipeline-a", stageId: "demo", version: 1 },
		],
	});
	assert.deepEqual(result.summary, { deals: 3, assignments: 3, matched: 1, dealMismatches: 2, orphanAssignments: 1, mismatched: 3, mismatchRate: 2 / 3 });
	assert.deepEqual(result.mismatches.map((row) => row.code), ["STAGE_MISMATCH", "MISSING_ASSIGNMENT", "ORPHAN_ASSIGNMENT"]);
});
