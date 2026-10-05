#!/usr/bin/env node
/** Real PostgreSQL acceptance, never a replacement with an in-memory repository. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveTestDatabase } from "../../packages/db/src/test-database.mjs";
import { createEvidenceRedactor } from "../quality/lib/redact-evidence.mjs";
import {
	hasCompleteTestEvidence,
	parseBunTestSummary,
} from "../quality/lib/test-evidence.mjs";

const root = resolve(import.meta.dirname, "../..");
const directory = resolve(root, "docs/quality");
const blockers = [];
const available = (cmd, args) => {
	const result = spawnSync(cmd, args, {
		cwd: root,
		encoding: "utf8",
		timeout: 10000,
	});
	return !result.error && result.status === 0;
};
try {
	resolveTestDatabase(process.env);
} catch (error) {
	blockers.push(error.message);
}
if (!available("bun", ["--version"])) blockers.push("Bun is not available.");
const prismaInstalled = [
	"node_modules/.bin/prisma",
	"packages/db/node_modules/.bin/prisma",
].some((binary) =>
	["", ".exe", ".cmd"].some((suffix) =>
		existsSync(resolve(root, `${binary}${suffix}`)),
	),
);
if (!prismaInstalled)
	blockers.push(
		"Installed workspace dependencies including Prisma are required.",
	);
const redact = createEvidenceRedactor();
const commands = [];
const env = {
	...process.env,
	NODE_ENV: "test",
	TEST_RUN_ID: `ops-pg-${Date.now()}`,
};
function run(label, args, variables = env) {
	const startedAt = new Date();
	const result = spawnSync("bun", args, {
		cwd: root,
		env: variables,
		encoding: "utf8",
		timeout: 300000,
		maxBuffer: 32 * 1024 * 1024,
	});
	const item = {
		label,
		command: `bun ${args.join(" ")}`,
		startedAt: startedAt.toISOString(),
		durationMs: Date.now() - startedAt.getTime(),
		status: result.status === 0 && !result.error ? "passed" : "failed",
		exitCode: result.status,
		stdout: redact(result.stdout),
		stderr: redact(result.stderr),
		error: redact(result.error?.message),
	};
	commands.push(item);
	return item.status === "passed";
}
if (!blockers.length) {
	// test-db uses the same explicit TEST_DATABASE_URL guard and does not reset on drift.
	if (
		run("Migrate isolated test database", [
			"run",
			"--cwd",
			"packages/db",
			"db:test",
		]) &&
		run("Generate Prisma", ["run", "--cwd", "packages/db", "db:generate"], {
			...env,
			DATABASE_URL: process.env.TEST_DATABASE_URL,
		})
	) {
		run(
			"Migration receipts, bound approvals and native-continuation persistence on PostgreSQL",
			[
				"test",
				"--preload",
				"./apps/api/test/setup.ts",
				"apps/api/test/operations-postgres.integration.spec.ts",
			],
		);
	}
}
const acceptance = commands.find((row) => row.command.startsWith("bun test "));
const testSummary = parseBunTestSummary(
	`${acceptance?.stdout ?? ""}\n${acceptance?.stderr ?? ""}`,
);
const passed =
	!blockers.length &&
	commands.length === 3 &&
	commands.every((row) => row.status === "passed") &&
	hasCompleteTestEvidence(testSummary);
const report = {
	scopeId: "MIG-APPROVAL-POSTGRES-001",
	generatedAt: new Date().toISOString(),
	status: passed ? "VERIFIED" : blockers.length ? "BLOCKED_EXTERNAL" : "FAILED",
	criticalChecksPassed: passed,
	wholeProductProductionReady: false,
	safety: {
		explicitTestDatabaseRequired: true,
		productionDatabaseFallback: false,
		automaticReset: false,
		remoteRequiresExplicitOptIn: true,
	},
	blockers,
	commands: commands.map(({ stdout, stderr, ...row }) => ({
		...row,
		stdoutTail: stdout.slice(-8000),
		stderrTail: stderr.slice(-8000),
	})),
	testSummary,
	nextScopeId: passed
		? "MIG-APPROVAL-AUTHENTICATED-E2E-001"
		: "MIG-APPROVAL-POSTGRES-001",
};
mkdirSync(directory, { recursive: true });
writeFileSync(
	resolve(directory, "generated-operations-postgres-report.json"),
	`${JSON.stringify(report, null, "\t")}\n`,
);
writeFileSync(
	resolve(directory, "generated-operations-postgres-build.log"),
	`${blockers.map((reason) => `BLOCKED_EXTERNAL: ${reason}`).join("\n")}\n${commands.map((row) => `\n${row.label}\n${row.command}\n${row.status}\n${row.stdout}\n${row.stderr}`).join("\n")}\n`,
);
console.log(
	JSON.stringify({
		status: report.status,
		blockers,
		nextScopeId: report.nextScopeId,
	}),
);
if (!passed) process.exitCode = blockers.length ? 2 : 1;
