#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import {
	auditAgentActionBoundaries,
	summarizeAgentActionBoundaryFindings,
} from "../quality/lib/agent-action-boundary-audit.mjs";

const root = resolve(process.cwd());
const requiredFiles = [
	"packages/action-registry/src/index.mjs",
	"packages/action-registry/src/registry.mjs",
	"packages/action-registry/test/actions.test.mjs",
	"packages/agent-action-runtime/src/index.mjs",
	"packages/agent-action-runtime/src/prisma-stores.mjs",
	"packages/agent-action-runtime/test/governed-action-runtime.test.mjs",
	"packages/agent-action-runtime/test/prisma-stores.test.mjs",
	"packages/integration-runtime/src/http-executor.mjs",
	"packages/integration-runtime/test/integration.test.mjs",
	"apps/agent/src/governed-action-service-core.mjs",
	"apps/agent/src/governed-action-execution.mjs",
	"apps/agent/src/governed-action-prisma-composition.mjs",
	"apps/agent/test/governed-action-execution.test.mjs",
	"docs/architecture/action-registry.md",
	"docs/adr/0008-catalog-only-action-registry.md",
	"docs/implementation/MASTER_SCOPE.md",
	"docs/quality/generated-agent-action-boundary-audit.json",
	"DELIVERY_AGENT_ACTION_REPAIR.md",
	"tools/release/run-agent-action-repair-gate.mjs",
];
const forbiddenFiles = [
	"packages/action-registry/src/approval.mjs",
	"packages/action-registry/src/state.mjs",
];
const productionFilesWithoutPlaceholders = [
	"packages/action-registry/src/errors.mjs",
	"packages/action-registry/src/registry.mjs",
	"packages/action-registry/src/schema.mjs",
	"packages/agent-action-runtime/src/index.mjs",
	"packages/agent-action-runtime/src/prisma-stores.mjs",
	"packages/integration-runtime/src/http-executor.mjs",
	"apps/agent/src/governed-action-service-core.mjs",
	"apps/agent/src/governed-action-execution.mjs",
	"apps/agent/src/governed-action-prisma-composition.mjs",
];

async function exists(relativePath) {
	try {
		await access(resolve(root, relativePath));
		return true;
	} catch {
		return false;
	}
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

for (const file of requiredFiles) {
	assert(await exists(file), `Required repair file is missing: ${file}`);
}
for (const file of forbiddenFiles) {
	assert(
		!(await exists(file)),
		`Removed parallel execution file still exists: ${file}`,
	);
}

const manifest = JSON.parse(
	await readFile(resolve(root, "package.json"), "utf8"),
);
assert(
	typeof manifest.scripts?.["test:agent-action-repair"] === "string",
	"test:agent-action-repair script is missing",
);
assert(
	typeof manifest.scripts?.["verify:agent-action-repair"] === "string",
	"verify:agent-action-repair script is missing",
);
assert(
	typeof manifest.scripts?.["gate:agent-action-repair"] === "string",
	"gate:agent-action-repair script is missing",
);

const registrySource = await readFile(
	resolve(root, "packages/action-registry/src/registry.mjs"),
	"utf8",
);
const registryApiStart = registrySource.indexOf("api = Object.freeze({");
const registryApiEnd = registrySource.indexOf("\n  });", registryApiStart);
assert(
	registryApiStart >= 0 && registryApiEnd > registryApiStart,
	"Could not locate the action catalog public API",
);
const registryApi = registrySource.slice(registryApiStart, registryApiEnd);
assert(
	!/\bexecute\s*\(/.test(registryApi),
	"Action catalog exposes a direct execute method",
);
assert(
	registrySource.includes(
		"export const createActionCatalog = createActionRegistry",
	),
	"Catalog compatibility export is missing",
);

const appComposition = await readFile(
	resolve(root, "apps/agent/src/governed-action-execution.mjs"),
	"utf8",
);
assert(
	!appComposition.includes("createActionRegistry"),
	"Agent application still creates a fallback action registry",
);
assert(
	appComposition.includes("createGovernedActionExecutor"),
	"Agent application is not composed through the governed executor",
);

const runtimeSource = await readFile(
	resolve(root, "packages/agent-action-runtime/src/index.mjs"),
	"utf8",
);
assert(
	runtimeSource.includes("idempotencyKey: req.idempotencyKey ?? null"),
	"Executor does not receive the provider idempotency key",
);
assert(
	runtimeSource.includes("operationDigest: digest"),
	"Executor does not receive the operation digest",
);
assert(
	runtimeSource.includes("throwIfAborted(externalSignal)"),
	"Pre-side-effect cancellation guard is missing",
);

const httpSource = await readFile(
	resolve(root, "packages/integration-runtime/src/http-executor.mjs"),
	"utf8",
);
assert(
	httpSource.includes("resolvedOptions.all === true"),
	"Pinned DNS lookup does not support Node all-address lookup mode",
);
assert(
	httpSource.includes("autoSelectFamily: false"),
	"Pinned connection does not disable automatic address reselection",
);
assert(
	httpSource.includes("Request deadline exceeded"),
	"Total outbound request deadline is missing",
);

const schema = await readFile(
	resolve(root, "packages/db/prisma/schema.prisma"),
	"utf8",
);
for (const model of [
	"GovernedActionReceipt",
	"GovernedActionApproval",
	"GovernedActionAuditEvent",
]) {
	assert(schema.includes(`model ${model}`), `Prisma model ${model} is missing`);
}
const migration = await readFile(
	resolve(
		root,
		"packages/db/prisma/migrations/20260831190000_governed_action_execution/migration.sql",
	),
	"utf8",
);
for (const table of [
	"GovernedActionReceipt",
	"GovernedActionApproval",
	"GovernedActionAuditEvent",
]) {
	assert(
		migration.includes(`CREATE TABLE IF NOT EXISTS \"${table}\"`),
		`Migration table ${table} is missing`,
	);
}

for (const file of productionFilesWithoutPlaceholders) {
	const source = await readFile(resolve(root, file), "utf8");
	assert(
		!/\b(?:TODO|FIXME)\b/.test(source),
		`Unresolved placeholder remains in ${file}`,
	);
}

const findings = await auditAgentActionBoundaries(root);
const counts = summarizeAgentActionBoundaryFindings(findings);
assert(
	counts.error === 0,
	`Action boundary audit has ${counts.error} blocking finding(s)`,
);
assert(
	counts.migration === 0,
	`Action boundary audit has ${counts.migration} legacy migration finding(s)`,
);

const result = Object.freeze({
	ok: true,
	requiredFiles: requiredFiles.length,
	forbiddenFilesAbsent: forbiddenFiles.length,
	blockingBoundaryFindings: counts.error,
	legacyMigrationFindings: counts.migration,
	nextScopeId: "CRM-PIPE-API-003",
});
console.log(JSON.stringify(result));
