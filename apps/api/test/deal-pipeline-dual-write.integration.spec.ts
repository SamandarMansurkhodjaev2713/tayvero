import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type DealStage, db, type Prisma } from "@crm/db";
import { DealPipelineBridgeService } from "../src/deals/deal-pipeline-bridge.service";

const suffix = process.env.TEST_RUN_ID ?? `pipeline-dual-write-${process.pid}`;
const tenantId = `tenant-${suffix}`;
const userId = `user-${suffix}`;
const companyId = `company-${suffix}`;
const dealId = `deal-${suffix}`;
const pipelineId = `pipeline-${suffix}`;
const stageIds = {
	open: `stage-open-${suffix}`,
	won: `stage-won-${suffix}`,
	lost: `stage-lost-${suffix}`,
} as const;
const initialStageChangedAt = new Date("2026-09-05T00:00:00.000Z");

let bridge: DealPipelineBridgeService;

const mappingRows = [
	["DEMO_BOOKED", stageIds.open],
	["QUALIFIED_TO_BUY", stageIds.open],
	["DECISION_MAKER_BOUGHT_IN", stageIds.open],
	["CONTRACT_SENT", stageIds.open],
	["UNQUALIFIED_TO_BUY", stageIds.lost],
	["CLOSED_WON", stageIds.won],
	["CLOSED_LOST", stageIds.lost],
] as const satisfies ReadonlyArray<readonly [DealStage, string]>;

async function clean() {
	await db.crmLegacyDealStageMapping.deleteMany({
		where: { workspaceId: tenantId },
	});
	await db.crmDealPipelineAssignment.deleteMany({
		where: { workspaceId: tenantId },
	});
	await db.crmPipeline.deleteMany({ where: { workspaceId: tenantId } });
	await db.deal.deleteMany({ where: { id: dealId } });
	await db.company.deleteMany({ where: { id: companyId } });
	await db.user.deleteMany({ where: { id: userId } });
}

async function transition(stage: DealStage, changedAt = new Date()) {
	return db.$transaction(async (tx) => {
		const [current] = await tx.$queryRaw<
			Array<{ id: string; stage: DealStage; stageChangedAt: Date }>
		>`
			SELECT id, stage, "stageChangedAt"
			FROM deal
			WHERE id = ${dealId}
			FOR UPDATE
		`;
		if (!current) throw new Error("fixture deal disappeared");

		await tx.deal.update({
			where: { id: dealId },
			data: { stage, stageChangedAt: changedAt },
		});
		await bridge.syncLegacyStage(tx as Prisma.TransactionClient, {
			workspaceId: tenantId,
			dealId,
			legacyStage: stage,
			changedAt,
		});
		return { from: current.stage, to: stage, changedAt };
	});
}

beforeAll(async () => {
	await clean();
	const previousMode = process.env.CRM_PIPELINE_DUAL_WRITE_MODE;
	process.env.CRM_PIPELINE_DUAL_WRITE_MODE = "strict";
	bridge = new DealPipelineBridgeService();
	if (previousMode === undefined)
		delete process.env.CRM_PIPELINE_DUAL_WRITE_MODE;
	else process.env.CRM_PIPELINE_DUAL_WRITE_MODE = previousMode;

	await db.user.create({
		data: {
			id: userId,
			name: "Pipeline Integration Test",
			email: `${suffix}@example.test`,
		},
	});
	await db.company.create({
		data: { id: companyId, name: `Pipeline Test ${suffix}` },
	});
	await db.deal.create({
		data: {
			id: dealId,
			name: `Dual-write ${suffix}`,
			companyId,
			ownerId: userId,
			stage: "DEMO_BOOKED",
			stageChangedAt: initialStageChangedAt,
		},
	});
	await db.crmPipeline.create({
		data: {
			id: pipelineId,
			workspaceId: tenantId,
			name: "Dual-write integration",
			slug: `dual-write-${suffix}`,
			isDefault: true,
		},
	});
	await db.crmPipelineStage.createMany({
		data: [
			{
				id: stageIds.open,
				workspaceId: tenantId,
				pipelineId,
				key: "open",
				name: "Open",
				position: 0,
				stageType: "OPEN",
				probabilityBps: 3000,
				allowedFromStageIds: [],
			},
			{
				id: stageIds.won,
				workspaceId: tenantId,
				pipelineId,
				key: "won",
				name: "Won",
				position: 1,
				stageType: "WON",
				probabilityBps: 10000,
				allowedFromStageIds: [],
			},
			{
				id: stageIds.lost,
				workspaceId: tenantId,
				pipelineId,
				key: "lost",
				name: "Lost",
				position: 2,
				stageType: "LOST",
				probabilityBps: 0,
				allowedFromStageIds: [],
			},
		],
	});
	await db.crmLegacyDealStageMapping.createMany({
		data: mappingRows.map(([legacyStage, stageId]) => ({
			workspaceId: tenantId,
			legacyStage,
			pipelineId,
			stageId,
		})),
	});
});

afterAll(clean);

describe("legacy Deal.stage -> configurable pipeline PostgreSQL bridge", () => {
	it("creates the sidecar assignment transactionally and preserves enteredAt", async () => {
		await transition("DEMO_BOOKED", initialStageChangedAt);
		const assignment = await db.crmDealPipelineAssignment.findUniqueOrThrow({
			where: { workspaceId_dealId: { workspaceId: tenantId, dealId } },
		});
		expect(assignment.pipelineId).toBe(pipelineId);
		expect(assignment.stageId).toBe(stageIds.open);
		expect(assignment.enteredAt.toISOString()).toBe(
			initialStageChangedAt.toISOString(),
		);
	});

	it("rolls back the legacy write if strict mapping is missing", async () => {
		await db.crmLegacyDealStageMapping.delete({
			where: {
				workspaceId_legacyStage: {
					workspaceId: tenantId,
					legacyStage: "CLOSED_LOST",
				},
			},
		});
		const before = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
		const beforeAssignment =
			await db.crmDealPipelineAssignment.findUniqueOrThrow({
				where: { workspaceId_dealId: { workspaceId: tenantId, dealId } },
			});

		await expect(transition("CLOSED_LOST")).rejects.toThrow(
			"legacy write was rolled back",
		);

		const after = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
		const afterAssignment =
			await db.crmDealPipelineAssignment.findUniqueOrThrow({
				where: { workspaceId_dealId: { workspaceId: tenantId, dealId } },
			});
		expect(after.stage).toBe(before.stage);
		expect(after.stageChangedAt.toISOString()).toBe(
			before.stageChangedAt.toISOString(),
		);
		expect(afterAssignment.stageId).toBe(beforeAssignment.stageId);
		expect(afterAssignment.version).toBe(beforeAssignment.version);

		await db.crmLegacyDealStageMapping.create({
			data: {
				workspaceId: tenantId,
				legacyStage: "CLOSED_LOST",
				pipelineId,
				stageId: stageIds.lost,
			},
		});
	});

	it("serializes simultaneous stage transitions and leaves legacy plus sidecar consistent", async () => {
		await Promise.all([
			transition("CLOSED_WON", new Date("2026-09-05T01:00:00.000Z")),
			transition("CLOSED_LOST", new Date("2026-09-05T01:00:01.000Z")),
		]);

		const [deal, assignment] = await Promise.all([
			db.deal.findUniqueOrThrow({
				where: { id: dealId },
				select: { stage: true, stageChangedAt: true },
			}),
			db.crmDealPipelineAssignment.findUniqueOrThrow({
				where: { workspaceId_dealId: { workspaceId: tenantId, dealId } },
			}),
		]);
		const expectedStageId = new Map<DealStage, string>(mappingRows).get(
			deal.stage,
		);
		expect(expectedStageId).toBeDefined();
		if (!expectedStageId)
			throw new Error(
				"The persisted legacy stage has no expected pipeline mapping.",
			);
		expect(assignment.pipelineId).toBe(pipelineId);
		expect(assignment.stageId).toBe(expectedStageId);
		expect(assignment.enteredAt.toISOString()).toBe(
			deal.stageChangedAt.toISOString(),
		);
		expect(assignment.version).toBeGreaterThan(1);
	});
});
