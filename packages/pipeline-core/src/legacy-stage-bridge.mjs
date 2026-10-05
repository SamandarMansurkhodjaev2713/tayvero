import { createHash } from "node:crypto";
import { fail } from "./errors.mjs";
import { parseAssignment, parsePipelineDefinition } from "./validation.mjs";

export const LEGACY_DEAL_STAGES = Object.freeze([
	"DEMO_BOOKED",
	"QUALIFIED_TO_BUY",
	"UNQUALIFIED_TO_BUY",
	"DECISION_MAKER_BOUGHT_IN",
	"CONTRACT_SENT",
	"CLOSED_WON",
	"CLOSED_LOST",
]);

const LEGACY_STAGE_SET = new Set(LEGACY_DEAL_STAGES);
const EXPECTED_STAGE_TYPE = Object.freeze({
	DEMO_BOOKED: "OPEN",
	QUALIFIED_TO_BUY: "OPEN",
	DECISION_MAKER_BOUGHT_IN: "OPEN",
	CONTRACT_SENT: "OPEN",
	UNQUALIFIED_TO_BUY: "LOST",
	CLOSED_WON: "WON",
	CLOSED_LOST: "LOST",
});

function object(value, code, message) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		fail(code, message);
	}
	return value;
}

function stableDigest(value) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function parseLegacyDealStage(value, path = "legacyStage") {
	if (typeof value !== "string" || !LEGACY_STAGE_SET.has(value)) {
		fail(
			"INVALID_LEGACY_STAGE",
			`${path} is not a supported legacy DealStage`,
			{
				path,
				value,
			},
		);
	}
	return value;
}

export function compileLegacyStageMapping(input) {
	const source = object(
		input,
		"INVALID_LEGACY_MAPPING",
		"Legacy stage mapping input must be an object",
	);
	const pipeline = parsePipelineDefinition(source.pipeline);
	if (pipeline.isArchived) {
		fail(
			"PIPELINE_ARCHIVED",
			"Legacy stage mapping cannot target an archived pipeline",
		);
	}
	const rawMapping = object(
		source.mapping,
		"INVALID_LEGACY_MAPPING",
		"mapping must be an object",
	);
	const extras = Object.keys(rawMapping).filter(
		(key) => !LEGACY_STAGE_SET.has(key),
	);
	if (extras.length > 0) {
		fail(
			"UNKNOWN_LEGACY_STAGE",
			"Legacy mapping contains unsupported stage keys",
			{ stages: extras.sort() },
		);
	}
	const stageById = new Map(pipeline.stages.map((stage) => [stage.id, stage]));
	const rows = [];
	for (const legacyStage of LEGACY_DEAL_STAGES) {
		const stageId = rawMapping[legacyStage];
		if (typeof stageId !== "string" || stageId.trim() === "") {
			fail(
				"UNMAPPED_LEGACY_STAGE",
				"Every legacy DealStage requires an explicit target",
				{ legacyStage },
			);
		}
		const stage = stageById.get(stageId);
		if (!stage) {
			fail(
				"UNKNOWN_MAPPED_STAGE",
				"Legacy mapping points to a stage outside the selected pipeline",
				{
					legacyStage,
					stageId,
				},
			);
		}
		const expectedType = EXPECTED_STAGE_TYPE[legacyStage];
		if (stage.type !== expectedType) {
			fail(
				"LEGACY_STAGE_TYPE_MISMATCH",
				"Legacy stage semantics do not match the target pipeline stage type",
				{
					legacyStage,
					stageId,
					expectedType,
					actualType: stage.type,
				},
			);
		}
		rows.push(
			Object.freeze({
				tenantId: pipeline.tenantId,
				legacyStage,
				pipelineId: pipeline.id,
				stageId: stage.id,
			}),
		);
	}
	const canonical = rows.map(({ legacyStage, pipelineId, stageId }) => ({
		legacyStage,
		pipelineId,
		stageId,
	}));
	return Object.freeze({
		tenantId: pipeline.tenantId,
		pipelineId: pipeline.id,
		count: rows.length,
		digest: stableDigest(canonical),
		rows: Object.freeze(rows),
	});
}

export function reconcileLegacyStageAssignments(input) {
	const source = object(
		input,
		"INVALID_RECONCILIATION_INPUT",
		"Reconciliation input must be an object",
	);
	const pipeline = parsePipelineDefinition(source.pipeline);
	const compiled = compileLegacyStageMapping({
		pipeline,
		mapping: source.mapping,
	});
	if (!Array.isArray(source.deals))
		fail("INVALID_DEALS", "deals must be an array");
	if (!Array.isArray(source.assignments))
		fail("INVALID_ASSIGNMENTS", "assignments must be an array");
	const maxRecords = source.maxRecords ?? 100_000;
	if (!Number.isSafeInteger(maxRecords) || maxRecords < 1)
		fail("INVALID_MAX_RECORDS", "maxRecords must be a positive safe integer");
	if (
		source.deals.length > maxRecords ||
		source.assignments.length > maxRecords
	) {
		fail(
			"RECONCILIATION_TOO_LARGE",
			"Reconciliation input exceeds the configured bound",
			{ maxRecords },
		);
	}
	const targetByLegacy = new Map(
		compiled.rows.map((row) => [row.legacyStage, row]),
	);
	const assignmentByDeal = new Map();
	for (let index = 0; index < source.assignments.length; index += 1) {
		const assignment = parseAssignment(
			source.assignments[index],
			`assignments[${index}]`,
		);
		if (assignment.tenantId !== pipeline.tenantId) {
			fail("TENANT_MISMATCH", "Assignment belongs to another tenant", {
				dealId: assignment.dealId,
			});
		}
		if (assignmentByDeal.has(assignment.dealId)) {
			fail(
				"DUPLICATE_ASSIGNMENT",
				"Reconciliation input contains duplicate deal assignments",
				{ dealId: assignment.dealId },
			);
		}
		assignmentByDeal.set(assignment.dealId, assignment);
	}
	const seenDeals = new Set();
	const mismatches = [];
	let matched = 0;
	for (let index = 0; index < source.deals.length; index += 1) {
		const deal = object(
			source.deals[index],
			"INVALID_DEAL",
			"Each deal must be an object",
		);
		if (deal.tenantId !== pipeline.tenantId) {
			fail("TENANT_MISMATCH", "Deal belongs to another tenant", {
				index,
				dealId: deal.id,
			});
		}
		if (typeof deal.id !== "string" || deal.id.trim() === "")
			fail("INVALID_DEAL_ID", "Deal ID is required", { index });
		if (seenDeals.has(deal.id))
			fail(
				"DUPLICATE_DEAL",
				"Reconciliation input contains the same deal twice",
				{ dealId: deal.id },
			);
		seenDeals.add(deal.id);
		const legacyStage = parseLegacyDealStage(
			deal.legacyStage,
			`deals[${index}].legacyStage`,
		);
		const expected = targetByLegacy.get(legacyStage);
		const actual = assignmentByDeal.get(deal.id);
		if (!actual) {
			mismatches.push(
				Object.freeze({
					dealId: deal.id,
					code: "MISSING_ASSIGNMENT",
					legacyStage,
					expectedStageId: expected.stageId,
				}),
			);
			continue;
		}
		assignmentByDeal.delete(deal.id);
		if (actual.pipelineId !== expected.pipelineId) {
			mismatches.push(
				Object.freeze({
					dealId: deal.id,
					code: "PIPELINE_MISMATCH",
					legacyStage,
					expectedPipelineId: expected.pipelineId,
					actualPipelineId: actual.pipelineId,
				}),
			);
			continue;
		}
		if (actual.stageId !== expected.stageId) {
			mismatches.push(
				Object.freeze({
					dealId: deal.id,
					code: "STAGE_MISMATCH",
					legacyStage,
					expectedStageId: expected.stageId,
					actualStageId: actual.stageId,
				}),
			);
			continue;
		}
		matched += 1;
	}
	for (const assignment of assignmentByDeal.values()) {
		mismatches.push(
			Object.freeze({
				dealId: assignment.dealId,
				code: "ORPHAN_ASSIGNMENT",
				actualPipelineId: assignment.pipelineId,
				actualStageId: assignment.stageId,
			}),
		);
	}
	const orphanAssignments = mismatches.filter(
		(row) => row.code === "ORPHAN_ASSIGNMENT",
	).length;
	const dealMismatches = mismatches.length - orphanAssignments;
	const summary = Object.freeze({
		deals: source.deals.length,
		assignments: source.assignments.length,
		matched,
		dealMismatches,
		orphanAssignments,
		mismatched: mismatches.length,
		mismatchRate:
			source.deals.length === 0 ? 0 : dealMismatches / source.deals.length,
	});
	return Object.freeze({
		pipelineId: pipeline.id,
		tenantId: pipeline.tenantId,
		mappingDigest: compiled.digest,
		summary,
		mismatches: Object.freeze(mismatches),
		digest: stableDigest({ summary, mismatches }),
	});
}
