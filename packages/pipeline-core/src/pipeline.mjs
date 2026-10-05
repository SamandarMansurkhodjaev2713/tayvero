import { createHash } from "node:crypto";
import { fail } from "./errors.mjs";
import { parseAssignment, parsePipelineDefinition } from "./validation.mjs";

function requireTenant(value, expected, path) {
	if (value !== expected)
		fail("TENANT_MISMATCH", `${path} belongs to another tenant`, {
			expectedTenantId: expected,
		});
}

function requireSafeInteger(value, path, min = 0) {
	if (!Number.isSafeInteger(value) || value < min)
		fail("INVALID_INTEGER", `${path} must be a safe integer`, { path, min });
	return value;
}

function parseMinorUnits(value, path) {
	if (typeof value === "bigint") return value;
	if (typeof value === "number" && Number.isSafeInteger(value))
		return BigInt(value);
	if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
	fail("INVALID_MINOR_UNITS", `${path} must be an integer minor-unit value`, {
		path,
	});
}

export function planDealStageTransition(input) {
	if (input === null || typeof input !== "object" || Array.isArray(input))
		fail("INVALID_TRANSITION", "Transition input must be an object");
	const pipeline = parsePipelineDefinition(input.pipeline);
	const assignment = parseAssignment(input.assignment);
	requireTenant(assignment.tenantId, pipeline.tenantId, "assignment");
	if (assignment.pipelineId !== pipeline.id)
		fail(
			"PIPELINE_MISMATCH",
			"Deal assignment does not belong to the selected pipeline",
		);
	if (pipeline.isArchived)
		fail("PIPELINE_ARCHIVED", "Deals cannot move inside an archived pipeline");
	const expectedVersion = requireSafeInteger(
		input.expectedVersion,
		"expectedVersion",
		1,
	);
	if (assignment.version !== expectedVersion)
		fail("STALE_ASSIGNMENT", "The deal stage changed after it was read", {
			expectedVersion,
			actualVersion: assignment.version,
		});

	const current = pipeline.stages.find(
		(stage) => stage.id === assignment.stageId,
	);
	const target = pipeline.stages.find(
		(stage) => stage.id === input.targetStageId,
	);
	if (!current)
		fail(
			"CURRENT_STAGE_NOT_FOUND",
			"Current deal stage is absent from the pipeline",
			{ stageId: assignment.stageId },
		);
	if (!target)
		fail(
			"TARGET_STAGE_NOT_FOUND",
			"Target deal stage is absent from the pipeline",
			{ stageId: input.targetStageId },
		);
	if (current.id === target.id) {
		return Object.freeze({ changed: false, assignment, event: null });
	}
	const allowReopen = input.allowReopen === true;
	if (
		(current.type === "WON" || current.type === "LOST") &&
		target.type === "OPEN" &&
		!allowReopen
	) {
		fail(
			"REOPEN_REQUIRES_EXPLICIT_PERMISSION",
			"Reopening a terminal deal requires an explicit permission",
		);
	}
	if (
		target.allowedFromStageIds.length > 0 &&
		!target.allowedFromStageIds.includes(current.id)
	) {
		fail(
			"TRANSITION_NOT_ALLOWED",
			"Pipeline transition rules reject this stage movement",
			{ fromStageId: current.id, toStageId: target.id },
		);
	}
	const next = Object.freeze({
		...assignment,
		stageId: target.id,
		version: assignment.version + 1,
	});
	return Object.freeze({
		changed: true,
		assignment: next,
		event: Object.freeze({
			type: "crm.deal.stage_changed",
			tenantId: pipeline.tenantId,
			dealId: assignment.dealId,
			pipelineId: pipeline.id,
			fromStageId: current.id,
			toStageId: target.id,
			previousVersion: assignment.version,
			version: next.version,
		}),
	});
}

export function buildLegacyStageMigrationPlan(input) {
	const pipeline = parsePipelineDefinition(input.pipeline);
	if (!Array.isArray(input.deals))
		fail("INVALID_DEALS", "deals must be an array");
	const maxDeals = input.maxDeals ?? 100_000;
	requireSafeInteger(maxDeals, "maxDeals", 1);
	if (input.deals.length > maxDeals)
		fail(
			"MIGRATION_BATCH_TOO_LARGE",
			"Legacy migration plan exceeds the configured limit",
			{ maxDeals },
		);
	if (
		input.mapping === null ||
		typeof input.mapping !== "object" ||
		Array.isArray(input.mapping)
	)
		fail("INVALID_MAPPING", "mapping must be an object");
	const stageIds = new Set(pipeline.stages.map((stage) => stage.id));
	const assignments = [];
	const seenDeals = new Set();
	for (let index = 0; index < input.deals.length; index += 1) {
		const deal = input.deals[index];
		if (deal === null || typeof deal !== "object" || Array.isArray(deal))
			fail("INVALID_DEAL", "Each deal must be an object", { index });
		requireTenant(deal.tenantId, pipeline.tenantId, `deals[${index}]`);
		if (typeof deal.id !== "string" || deal.id.trim() === "")
			fail("INVALID_DEAL_ID", "Deal ID is required", { index });
		if (seenDeals.has(deal.id))
			fail(
				"DUPLICATE_DEAL",
				"The migration input contains the same deal twice",
				{ dealId: deal.id },
			);
		seenDeals.add(deal.id);
		const targetStageId = input.mapping[deal.legacyStage];
		if (typeof targetStageId !== "string")
			fail("UNMAPPED_LEGACY_STAGE", "A legacy deal stage has no mapping", {
				legacyStage: deal.legacyStage,
				dealId: deal.id,
			});
		if (!stageIds.has(targetStageId))
			fail(
				"UNKNOWN_MAPPED_STAGE",
				"Legacy mapping points to an unknown pipeline stage",
				{ targetStageId },
			);
		assignments.push(
			Object.freeze({
				tenantId: pipeline.tenantId,
				dealId: deal.id,
				pipelineId: pipeline.id,
				stageId: targetStageId,
				version: 1,
			}),
		);
	}
	const digest = createHash("sha256")
		.update(JSON.stringify(assignments))
		.digest("hex");
	return Object.freeze({
		pipelineId: pipeline.id,
		tenantId: pipeline.tenantId,
		count: assignments.length,
		digest,
		assignments: Object.freeze(assignments),
	});
}

export function calculatePipelineAnalytics(input) {
	const pipeline = parsePipelineDefinition(input.pipeline);
	if (!Array.isArray(input.deals))
		fail("INVALID_DEALS", "deals must be an array");
	const now =
		input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
	if (Number.isNaN(now.getTime()))
		fail("INVALID_NOW", "now must be a valid date");
	const stageMap = new Map(
		pipeline.stages.map((stage) => [
			stage.id,
			{ stage, count: 0, totalMinor: 0n, totalAgeMs: 0 },
		]),
	);
	for (let index = 0; index < input.deals.length; index += 1) {
		const deal = input.deals[index];
		requireTenant(deal.tenantId, pipeline.tenantId, `deals[${index}]`);
		const bucket = stageMap.get(deal.stageId);
		if (!bucket)
			fail(
				"UNKNOWN_DEAL_STAGE",
				"Deal references a stage outside the pipeline",
				{ dealId: deal.id, stageId: deal.stageId },
			);
		const entered = new Date(deal.enteredStageAt);
		if (Number.isNaN(entered.getTime()) || entered.getTime() > now.getTime())
			fail(
				"INVALID_STAGE_TIME",
				"enteredStageAt must be a valid past timestamp",
				{ dealId: deal.id },
			);
		bucket.count += 1;
		bucket.totalMinor += parseMinorUnits(
			deal.amountMinor ?? 0,
			`deals[${index}].amountMinor`,
		);
		bucket.totalAgeMs += now.getTime() - entered.getTime();
	}
	const stages = pipeline.stages.map((stage) => {
		const bucket = stageMap.get(stage.id);
		return Object.freeze({
			stageId: stage.id,
			stageKey: stage.key,
			type: stage.type,
			count: bucket.count,
			totalAmountMinor: bucket.totalMinor.toString(),
			averageStageAgeSeconds:
				bucket.count === 0
					? 0
					: Math.floor(bucket.totalAgeMs / bucket.count / 1000),
		});
	});
	return Object.freeze({
		pipelineId: pipeline.id,
		tenantId: pipeline.tenantId,
		generatedAt: now.toISOString(),
		stages: Object.freeze(stages),
	});
}
