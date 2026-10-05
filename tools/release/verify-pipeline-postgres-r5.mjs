#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const required = [
	"apps/api/test/deal-pipeline-dual-write.integration.spec.ts",
	"tools/release/run-pipeline-postgres-gate.mjs",
	"tools/quality/test/pipeline-postgres-gate-boundary.test.mjs",
];
const missing = required.filter((path) => !existsSync(resolve(root, path)));
if (missing.length) {
	console.error(JSON.stringify({ ok: false, missing }));
	process.exit(1);
}
const runner = readFileSync(
	resolve(root, "tools/release/run-pipeline-postgres-gate.mjs"),
	"utf8",
);
const integration = readFileSync(
	resolve(root, "apps/api/test/deal-pipeline-dual-write.integration.spec.ts"),
	"utf8",
);
const failures = [];
if (!runner.includes("TEST_DATABASE_URL is required explicitly"))
	failures.push("explicit TEST_DATABASE_URL guard missing");
if (!runner.includes('endsWith("_test")'))
	failures.push("_test suffix guard missing");
if (runner.includes("TEST_DATABASE_URL ?? process.env.DATABASE_URL"))
	failures.push("unsafe live database fallback detected");
if (!integration.includes("FOR UPDATE"))
	failures.push("deal row lock coverage missing");
if (!integration.includes("legacy write was rolled back"))
	failures.push("rollback assertion missing");
if (!integration.includes("Promise.all"))
	failures.push("concurrency exercise missing");
console.log(
	JSON.stringify({
		ok: failures.length === 0,
		requiredFiles: required.length,
		failures,
		nextScopeId: "CRM-PIPE-POSTGRES-005",
	}),
);
if (failures.length) process.exit(1);
