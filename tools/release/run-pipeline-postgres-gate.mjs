#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { resolveTestDatabase } from "../../packages/db/src/test-database.mjs";
import { createEvidenceRedactor } from "../quality/lib/redact-evidence.mjs";

const root = resolve(import.meta.dirname, "../..");
const qualityDir = resolve(root, "docs/quality");
const reportPath = resolve(qualityDir, "generated-pipeline-postgres-005-report.json");
const logPath = resolve(qualityDir, "generated-pipeline-postgres-005-build.log");
const testUrl = process.env.TEST_DATABASE_URL ?? null;
const liveUrl = process.env.DATABASE_URL ?? null;
const bunPresent = commandAvailable("bun", ["--version"]);
const depsPresent = existsSync(resolve(root, "node_modules/.bin"));

function databaseName(value) {
	try { return new URL(value).pathname.replace(/^\//, ""); }
	catch { return value; }
}

function commandAvailable(command, args) {
	const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
	return !result.error && result.status === 0;
}

const redact = createEvidenceRedactor();

function run(label, command, args, env = process.env) {
	const startedAt = new Date();
	const result = spawnSync(command, args, {
		cwd: root,
		encoding: "utf8",
		env,
		maxBuffer: 64 * 1024 * 1024,
		timeout: 300_000,
	});
	const endedAt = new Date();
	return {
		label,
		command: [command, ...args].join(" "),
		status: !result.error && result.status === 0 ? "passed" : "failed",
		exitCode: result.status,
		error: redact(result.error?.message) || null,
		stdoutTail: redact(result.stdout).slice(-12000),
		stderrTail: redact(result.stderr).slice(-12000),
		startedAt: startedAt.toISOString(),
		endedAt: endedAt.toISOString(),
		durationMs: endedAt.getTime() - startedAt.getTime(),
	};
}

const blockers = [];
// Keep the simple guards below as visible defense in depth; canonical checks
// also reject the same live database under alternate credentials or aliases.
try { resolveTestDatabase(process.env); }
catch (error) { blockers.push(error.message); }
if (!testUrl) blockers.push("TEST_DATABASE_URL is required explicitly; this gate never falls back to DATABASE_URL.");
if (testUrl && !databaseName(testUrl).endsWith("_test")) blockers.push("TEST_DATABASE_URL must name a database ending in _test.");
if (testUrl && liveUrl && testUrl === liveUrl) blockers.push("TEST_DATABASE_URL must not equal DATABASE_URL.");
if (!bunPresent) blockers.push("Bun is required for Prisma generation and Bun integration tests.");
if (!depsPresent) blockers.push("Installed workspace dependencies are required (node_modules/.bin is absent).");

const commands = [];
if (blockers.length === 0) {
	const env = { ...process.env, NODE_ENV: "test", CRM_PIPELINE_DUAL_WRITE_MODE: "strict" };
	commands.push(run("Create/migrate isolated PostgreSQL test database", "bun", ["run", "--cwd", "packages/db", "db:test"], env));
	if (commands.at(-1).status === "passed") {
		commands.push(run("Generate Prisma client for integration tests", "bun", ["run", "--cwd", "packages/db", "db:generate"], { ...env, DATABASE_URL: testUrl }));
	}
	if (commands.at(-1).status === "passed") {
		commands.push(run(
			"Deal pipeline PostgreSQL transaction/rollback/concurrency suite",
			"bun",
			["test", "--preload", "./apps/api/test/setup.ts", "apps/api/test/deal-pipeline-dual-write.integration.spec.ts"],
			{ ...env, TEST_RUN_ID: `postgres-gate-${Date.now()}` },
		));
	}
}

const verified = blockers.length === 0 && commands.length === 3 && commands.every((item) => item.status === "passed");
const report = {
	stage: "CRM-PIPE-POSTGRES-005",
	scopeId: "CRM-PIPE-POSTGRES-005",
	artifactState: verified ? "VERIFIED_CHECKPOINT" : blockers.length ? "BLOCKED_EXTERNAL" : "FAILED",
	criticalChecksPassed: verified,
	nextScopeId: verified ? "CRM-PIPE-SHADOW-READ-006" : "CRM-PIPE-POSTGRES-005",
	generatedAt: new Date().toISOString(),
	safety: {
		requiresExplicitTestDatabase: true,
		requiresTestDatabaseSuffix: "_test",
		fallsBackToDatabaseUrl: false,
		testEqualsLiveRejected: true,
		canonicalDatabaseIdentityChecked: true,
		remoteDatabaseRequiresExplicitOptIn: true,
		automaticDatabaseReset: false,
	},
	environment: { bunPresent, depsPresent, testDatabaseConfigured: Boolean(testUrl) },
	blockers,
	commands,
};
mkdirSync(qualityDir, { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(logPath, `${commands.map((item) => `${item.label}: ${item.status}\n${item.stdoutTail}\n${item.stderrTail}`).join("\n\n")}\n`, "utf8");
console.log(JSON.stringify({ artifactState: report.artifactState, criticalChecksPassed: verified, nextScopeId: report.nextScopeId, blockers }));
if (!verified) process.exitCode = blockers.length > 0 ? 2 : 1;
