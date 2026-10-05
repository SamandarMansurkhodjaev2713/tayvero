import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("deal create and stage changes invoke strict sidecar synchronization inside the CRM transaction", async () => {
	const source = await read("apps/api/src/deals/deals.service.ts");
	assert.match(source, /await this\.pipelineBridge\.syncLegacyStage\(tx, \{[\s\S]*dealId: created\.id/);
	assert.match(source, /const updated = await tx\.deal\.update\([\s\S]*await this\.pipelineBridge\.syncLegacyStage\(tx, \{[\s\S]*legacyStage: input\.stage/);
	assert.match(source, /if \(deal\.stage === input\.stage\) \{[\s\S]*pipelineBridge\.syncLegacyStage/);
});

test("legacy reads remain authoritative in this checkpoint", async () => {
	const source = await read("apps/api/src/deals/deals.service.ts");
	assert.match(source, /select: \{[\s\S]*stage: true/);
	assert.match(source, /groupBy\(\{ by: \["stage"\]/);
});

test("strict dual-write is opt-in and the example environment leaves it off", async () => {
	const [core, env] = await Promise.all([
		read("apps/api/src/deals/deal-pipeline-bridge-core.mjs"),
		read(".env.example"),
	]);
	assert.match(core, /new Set\(\["off", "strict"\]\)/);
	assert.match(env, /^CRM_PIPELINE_DUAL_WRITE_MODE=off$/m);
});

test("the additive migration never removes or rewrites legacy deal.stage", async () => {
	const sql = await read("packages/db/prisma/migrations/20260905120000_deal_stage_dual_write_bridge/migration.sql");
	assert.doesNotMatch(sql, /DROP\s+(COLUMN|TYPE|TABLE)/i);
	assert.doesNotMatch(sql, /ALTER\s+TABLE\s+"?deal"?/i);
	assert.match(sql, /crm_legacy_deal_stage_mapping/);
});


test("strict mode guards default-pipeline handoff until every mapping is migrated", async () => {
	const source = await read("apps/api/src/pipelines/pipelines.service.ts");
	assert.match(source, /CRM_PIPELINE_DUAL_WRITE_MODE[\s\S]*crmLegacyDealStageMapping\.findMany/);
	assert.match(source, /mappings\.some\(\(mapping\) => mapping\.pipelineId !== input\.id\)/);
});

test("mapped stage removal or outcome-type mutation is blocked before runtime update", async () => {
	const source = await read("apps/api/src/pipelines/pipelines.service.ts");
	assert.match(source, /crmLegacyDealStageMapping\.findMany\([\s\S]*pipelineId: current\.id/);
	assert.match(source, /!previous \|\| !next \|\| previous\.type !== next\.type/);
	assert.match(source, /Remap and reconcile legacy stages before removing it or changing its outcome type/);
});

test("same-stage repair preserves the legacy stageChangedAt timestamp", async () => {
	const source = await read("apps/api/src/deals/deals.service.ts");
	assert.match(source, /SELECT id, stage, "companyId", "stageChangedAt"/);
	assert.match(source, /if \(deal\.stage === input\.stage\)[\s\S]*changedAt: deal\.stageChangedAt/);
});
