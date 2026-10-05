#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const required = [
	"apps/api/src/pipelines/pipeline-api-core.mjs",
	"apps/api/src/pipelines/pipelines.contracts.ts",
	"apps/api/src/pipelines/pipelines.module.ts",
	"apps/api/src/pipelines/pipelines.router.ts",
	"apps/api/src/pipelines/pipelines.service.ts",
	"apps/app/app/(app)/[slug]/settings/pipelines/page.tsx",
	"apps/app/app/(app)/[slug]/settings/pipelines/pipeline-settings.tsx",
	"apps/app/app/(app)/[slug]/settings/pipelines/pipeline-command-keys.mjs",
	"apps/app/test/pipeline-command-key-store.test.mjs",
	"packages/db/prisma/migrations/20260901150000_pipeline_api_runtime/migration.sql",
	"packages/pipeline-runtime/src/prisma-adapter.mjs",
];
for (const path of required) {
	if (!(await exists(path))) throw new Error(`Missing required pipeline API file: ${path}`);
}

const schema = await readFile("packages/db/prisma/schema.prisma", "utf8");
for (const model of ["CrmPipelineCommandReceipt", "CrmPipelineAuditEvent"]) {
	if (!schema.includes(`model ${model}`)) throw new Error(`Missing Prisma model ${model}`);
}
const contracts = await readFile("apps/api/src/pipelines/pipelines.contracts.ts", "utf8");
if (!/pipelineCreateInput[\s\S]*isDefault:\s*z\.boolean\(\)\.default\(false\)/.test(contracts)) {
	throw new Error("Pipeline create contract does not preserve optional default intent");
}
for (const forbidden of ["tenantId:", "workspaceId:", "organizationId:"]) {
	if (contracts.includes(forbidden)) throw new Error(`Public pipeline contract exposes ${forbidden}`);
}
const service = await readFile("apps/api/src/pipelines/pipelines.service.ts", "utf8");
if (!service.includes("activeOrganizationId") || !service.includes("organizationId_userId")) {
	throw new Error("Pipeline service does not derive tenant from verified membership");
}
const adapter = await readFile("packages/pipeline-runtime/src/prisma-adapter.mjs", "utf8");
if (adapter.includes('?? "tenantCommandReceipt"') || adapter.includes('?? "tenantSecurityAuditEvent"')) {
	throw new Error("Pipeline adapter still points to missing generic delegates");
}

const packageFiles = await collectPackageJson(".");
for (const path of packageFiles) JSON.parse(await readFile(path, "utf8"));
console.log(JSON.stringify({ verified: true, requiredFiles: required.length, packageFiles: packageFiles.length }));

async function exists(path) {
	try { return (await stat(path)).isFile(); } catch { return false; }
}
async function collectPackageJson(root) {
	const result = [];
	async function walk(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (["node_modules", ".git", ".next", "dist"].includes(entry.name)) continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await walk(path);
			else if (entry.name === "package.json") result.push(path);
		}
	}
	await walk(root);
	return result;
}
