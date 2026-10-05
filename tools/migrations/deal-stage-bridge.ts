import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "@crm/db";
import { WORKSPACE_ID } from "@crm/db/workspace";
import {
	compileLegacyStageMapping,
	reconcileLegacyStageAssignments,
} from "@crm/pipeline-core";

const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 2_000;
const MAX_RECONCILE_ROWS = 100_000;

type Cli = {
	apply: boolean;
	mappingFile: string;
	batchSize: number;
};

function usage(): never {
	throw new Error(
		"Usage: bun tools/migrations/deal-stage-bridge.ts --mapping <file.json> [--apply] [--batch-size 250]",
	);
}

function parseCli(argv: string[]): Cli {
	let apply = false;
	let mappingFile = "";
	let batchSize = DEFAULT_BATCH_SIZE;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--apply") apply = true;
		else if (arg === "--mapping") mappingFile = argv[++index] ?? "";
		else if (arg === "--batch-size") batchSize = Number(argv[++index]);
		else usage();
	}
	if (!mappingFile) usage();
	if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
		throw new Error(`--batch-size must be an integer between 1 and ${MAX_BATCH_SIZE}`);
	}
	return { apply, mappingFile: resolve(mappingFile), batchSize };
}

function pipelineDomain(row: {
	id: string;
	workspaceId: string;
	name: string;
	slug: string;
	isDefault: boolean;
	isArchived: boolean;
	version: number;
	stages: Array<{
		id: string;
		key: string;
		name: string;
		position: number;
		stageType: "OPEN" | "WON" | "LOST";
		probabilityBps: number;
		color: string | null;
		allowedFromStageIds: unknown;
	}>;
}) {
	return {
		id: row.id,
		tenantId: row.workspaceId,
		name: row.name,
		slug: row.slug,
		isDefault: row.isDefault,
		isArchived: row.isArchived,
		version: row.version,
		stages: row.stages.map((stage) => ({
			id: stage.id,
			key: stage.key,
			name: stage.name,
			position: stage.position,
			type: stage.stageType,
			probabilityBps: stage.probabilityBps,
			color: stage.color,
			allowedFromStageIds: Array.isArray(stage.allowedFromStageIds)
				? stage.allowedFromStageIds
				: [],
		})),
	};
}

async function readMapping(file: string): Promise<{ pipelineId: string; mapping: Record<string, string> }> {
	const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Mapping file must contain an object");
	const record = raw as Record<string, unknown>;
	if (typeof record.pipelineId !== "string" || !record.pipelineId.trim()) throw new Error("mapping.pipelineId is required");
	if (!record.mapping || typeof record.mapping !== "object" || Array.isArray(record.mapping)) throw new Error("mapping.mapping must be an object");
	return { pipelineId: record.pipelineId.trim(), mapping: record.mapping as Record<string, string> };
}

async function loadPipeline(pipelineId: string) {
	const row = await db.crmPipeline.findFirst({
		where: { workspaceId: WORKSPACE_ID, id: pipelineId },
		include: { stages: { orderBy: { position: "asc" } } },
	});
	if (!row) throw new Error("Selected pipeline does not exist in the current workspace");
	if (row.isArchived || !row.isDefault) throw new Error("Legacy bridge must target the active default pipeline");
	return pipelineDomain(row);
}

async function applyMapping(compiled: ReturnType<typeof compileLegacyStageMapping>) {
	await db.$transaction(async (tx) => {
		for (const row of compiled.rows) {
			await tx.crmLegacyDealStageMapping.upsert({
				where: { workspaceId_legacyStage: { workspaceId: row.tenantId, legacyStage: row.legacyStage } },
				create: {
					workspaceId: row.tenantId,
					legacyStage: row.legacyStage,
					pipelineId: row.pipelineId,
					stageId: row.stageId,
				},
				update: {
					pipelineId: row.pipelineId,
					stageId: row.stageId,
					version: { increment: 1 },
				},
			});
		}
	});
}

async function backfill(compiled: ReturnType<typeof compileLegacyStageMapping>, batchSize: number) {
	const target = new Map(compiled.rows.map((row) => [row.legacyStage, row]));
	let cursor: string | undefined;
	let scanned = 0;
	let created = 0;
	let updated = 0;
	let unchanged = 0;
	for (;;) {
		const deals = await db.deal.findMany({
			orderBy: { id: "asc" },
			take: batchSize,
			...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
			select: { id: true, stage: true, stageChangedAt: true },
		});
		if (deals.length === 0) break;
		await db.$transaction(async (tx) => {
			const existing = await tx.crmDealPipelineAssignment.findMany({
				where: { workspaceId: WORKSPACE_ID, dealId: { in: deals.map((deal) => deal.id) } },
				select: { id: true, dealId: true, pipelineId: true, stageId: true, version: true },
			});
			const byDeal = new Map(existing.map((row) => [row.dealId, row]));
			for (const deal of deals) {
				const mapped = target.get(deal.stage);
				if (!mapped) throw new Error(`Validated mapping unexpectedly missing ${deal.stage}`);
				const current = byDeal.get(deal.id);
				if (!current) {
					await tx.crmDealPipelineAssignment.create({
						data: {
							workspaceId: WORKSPACE_ID,
							dealId: deal.id,
							pipelineId: mapped.pipelineId,
							stageId: mapped.stageId,
							version: 1,
							enteredAt: deal.stageChangedAt,
						},
					});
					created += 1;
				} else if (current.pipelineId === mapped.pipelineId && current.stageId === mapped.stageId) {
					unchanged += 1;
				} else {
					const result = await tx.crmDealPipelineAssignment.updateMany({
						where: { id: current.id, version: current.version },
						data: {
							pipelineId: mapped.pipelineId,
							stageId: mapped.stageId,
							version: current.version + 1,
							enteredAt: deal.stageChangedAt,
						},
					});
					if (result.count !== 1) throw new Error(`Concurrent assignment update detected for deal ${deal.id}`);
					updated += 1;
				}
			}
		});
		scanned += deals.length;
		cursor = deals.at(-1)?.id;
	}
	return { scanned, created, updated, unchanged };
}

async function reconcile(pipeline: Awaited<ReturnType<typeof loadPipeline>>, mapping: Record<string, string>) {
	const [deals, assignments] = await Promise.all([
		db.deal.findMany({ take: MAX_RECONCILE_ROWS + 1, select: { id: true, stage: true } }),
		db.crmDealPipelineAssignment.findMany({
			where: { workspaceId: WORKSPACE_ID },
			take: MAX_RECONCILE_ROWS + 1,
			select: { dealId: true, pipelineId: true, stageId: true, version: true },
		}),
	]);
	if (deals.length > MAX_RECONCILE_ROWS || assignments.length > MAX_RECONCILE_ROWS) {
		throw new Error(`Reconciliation exceeds ${MAX_RECONCILE_ROWS} rows; use a bounded production reconciliation job before cutover`);
	}
	return reconcileLegacyStageAssignments({
		pipeline,
		mapping,
		deals: deals.map((deal) => ({ id: deal.id, tenantId: WORKSPACE_ID, legacyStage: deal.stage })),
		assignments: assignments.map((row) => ({ tenantId: WORKSPACE_ID, ...row })),
		maxRecords: MAX_RECONCILE_ROWS,
	});
}

async function main() {
	const cli = parseCli(process.argv.slice(2));
	const config = await readMapping(cli.mappingFile);
	const pipeline = await loadPipeline(config.pipelineId);
	const compiled = compileLegacyStageMapping({ pipeline, mapping: config.mapping });
	const before = await reconcile(pipeline, config.mapping);
	console.log(JSON.stringify({ mode: cli.apply ? "apply" : "dry-run", workspaceId: WORKSPACE_ID, mappingDigest: compiled.digest, before: before.summary }, null, 2));
	if (!cli.apply) {
		console.log("Dry-run only. No mapping or assignment rows were changed.");
		return;
	}
	await applyMapping(compiled);
	const backfillResult = await backfill(compiled, cli.batchSize);
	const after = await reconcile(pipeline, config.mapping);
	console.log(JSON.stringify({ backfill: backfillResult, after: after.summary, reconciliationDigest: after.digest }, null, 2));
	if (after.summary.mismatched !== 0) {
		throw new Error("Reconciliation is not clean. Keep CRM_PIPELINE_DUAL_WRITE_MODE=off.");
	}
	console.log("Reconciliation is clean. Strict dual-write may be enabled for the observation window; legacy reads remain authoritative.");
}

main()
	.catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	})
	.finally(async () => db.$disconnect());
