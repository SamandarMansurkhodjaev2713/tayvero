import { access, readFile } from "node:fs/promises";

const required = [
	"packages/pipeline-core/src/legacy-stage-bridge.mjs",
	"packages/pipeline-core/test/legacy-stage-bridge.test.mjs",
	"packages/db/prisma/migrations/20260905120000_deal_stage_dual_write_bridge/migration.sql",
	"apps/api/src/deals/deal-pipeline-bridge-core.mjs",
	"apps/api/src/deals/deal-pipeline-bridge.service.ts",
	"apps/api/test/deal-pipeline-bridge-core.test.mjs",
	"tools/migrations/deal-stage-bridge.ts",
	"tools/quality/test/deal-pipeline-dual-write-boundary.test.mjs",
];
for (const path of required) await access(path);
const progress = await readFile("progress.md", "utf8");
if (!progress.includes("CRM-PIPE-DUAL-WRITE-004")) throw new Error("Progress ledger is missing CRM-PIPE-DUAL-WRITE-004");
console.log(JSON.stringify({ ok: true, requiredFiles: required.length, nextScopeId: "CRM-PIPE-POSTGRES-005" }));
