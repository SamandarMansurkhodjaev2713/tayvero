#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";

const root = resolve(process.cwd());
const qualityDirectory = resolve(root, "docs/quality");
const reportPath = resolve(
	qualityDirectory,
	"generated-legacy-agent-action-migration-report.json",
);
const buildLogPath = resolve(
	qualityDirectory,
	"generated-legacy-agent-action-migration-build.log",
);
const generalReportPath = resolve(
	qualityDirectory,
	"generated-build-report.json",
);
const generalBuildLogPath = resolve(qualityDirectory, "generated-build.log");
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const EXCLUDED_DIRECTORIES = new Set([
	".git",
	".next",
	".turbo",
	"coverage",
	"dist",
	"node_modules",
]);

function walkFiles(directory, predicate, output = []) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
		const absolute = join(directory, entry.name);
		if (entry.isDirectory()) walkFiles(absolute, predicate, output);
		else if (entry.isFile() && predicate(absolute)) output.push(absolute);
	}
	return output;
}

function commandText(command, args) {
	return [command, ...args]
		.map((part) =>
			/^[A-Za-z0-9_./:@=*-]+$/u.test(part) ? part : JSON.stringify(part),
		)
		.join(" ");
}

function parseTap(output) {
	function lastNumber(label) {
		const matches = [
			...output.matchAll(new RegExp(`^# ${label} (\\d+)$`, "gmu")),
		];
		return matches.length > 0 ? Number(matches.at(-1)[1]) : null;
	}
	return {
		tests: lastNumber("tests"),
		passed: lastNumber("pass"),
		failed: lastNumber("fail"),
		skipped: lastNumber("skipped"),
		cancelled: lastNumber("cancelled"),
		todo: lastNumber("todo"),
	};
}

function execute({
	label,
	command,
	args = [],
	critical = true,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	classify,
}) {
	const startedAt = new Date();
	const result = spawnSync(command, args, {
		cwd: root,
		encoding: "utf8",
		env: process.env,
		maxBuffer: MAX_BUFFER_BYTES,
		timeout: timeoutMs,
	});
	const endedAt = new Date();
	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";
	let status;
	let reason = null;
	if (classify) {
		({ status, reason } = classify(result));
	} else if (result.error?.code === "ENOENT") {
		status = "not_available";
		reason = `${command} is not installed in the verification environment`;
	} else if (
		result.error?.code === "ETIMEDOUT" ||
		result.signal === "SIGTERM"
	) {
		status = "timeout";
		reason = `Command exceeded ${timeoutMs}ms`;
	} else {
		status = result.status === 0 ? "passed" : "failed";
	}
	return {
		label,
		command: commandText(command, args),
		cwd: root,
		startedAt: startedAt.toISOString(),
		endedAt: endedAt.toISOString(),
		durationMs: endedAt.getTime() - startedAt.getTime(),
		status,
		critical,
		exitCode: result.status,
		signal: result.signal ?? null,
		reason,
		stdout,
		stderr,
		tap:
			command === process.execPath && args.includes("--test")
				? parseTap(`${stdout}\n${stderr}`)
				: null,
	};
}

function unavailable(label, reason) {
	const now = new Date().toISOString();
	return {
		label,
		command: null,
		cwd: root,
		startedAt: now,
		endedAt: now,
		durationMs: 0,
		status: "not_available",
		critical: false,
		exitCode: null,
		signal: null,
		reason,
		stdout: "",
		stderr: "",
		tap: null,
	};
}

function blockedExternal(label, reason) {
	return { ...unavailable(label, reason), status: "blocked_external" };
}

function syntaxSweep(files) {
	const startedAt = new Date();
	const failures = [];
	for (const absolute of files) {
		const file = relative(root, absolute).replaceAll("\\", "/");
		const result = spawnSync(process.execPath, ["--check", file], {
			cwd: root,
			encoding: "utf8",
			env: process.env,
			maxBuffer: MAX_BUFFER_BYTES,
			timeout: 30_000,
		});
		if (result.error || result.status !== 0) {
			failures.push({
				file,
				exitCode: result.status,
				error: result.error?.message ?? null,
				stdout: result.stdout ?? "",
				stderr: result.stderr ?? "",
			});
		}
	}
	const endedAt = new Date();
	return {
		label: "Repository ESM syntax sweep",
		command: `node --check <${files.length} discovered .mjs files>`,
		cwd: root,
		startedAt: startedAt.toISOString(),
		endedAt: endedAt.toISOString(),
		durationMs: endedAt.getTime() - startedAt.getTime(),
		status: failures.length === 0 ? "passed" : "failed",
		critical: true,
		exitCode: failures.length === 0 ? 0 : 1,
		signal: null,
		reason:
			failures.length === 0
				? null
				: `${failures.length} ESM file(s) failed syntax validation`,
		stdout: JSON.stringify({ checkedFiles: files.length, failures }, null, 2),
		stderr: "",
		tap: null,
	};
}

function serializeCommand(command) {
	const { stdout, stderr, ...metadata } = command;
	return {
		...metadata,
		stdoutTail: stdout.slice(-12_000),
		stderrTail: stderr.slice(-12_000),
	};
}

function buildLog(commands) {
	return `${commands
		.map((item) =>
			[
				`===== ${item.label} =====`,
				item.command ? `$ ${item.command}` : "$ <not executed>",
				`cwd=${item.cwd}`,
				`startedAt=${item.startedAt}`,
				`endedAt=${item.endedAt}`,
				`status=${item.status} critical=${item.critical} rc=${item.exitCode ?? "null"} durationMs=${item.durationMs}`,
				item.reason ? `reason=${item.reason}` : null,
				item.stdout ? item.stdout.trimEnd() : null,
				item.stderr ? item.stderr.trimEnd() : null,
				"",
			]
				.filter((line) => line !== null)
				.join("\n"),
		)
		.join("\n")}\n`;
}

const roots = ["apps", "packages", "scripts", "tools"].map((part) =>
	resolve(root, part),
);
const allMjs = roots
	.flatMap((directory) => walkFiles(directory, (file) => file.endsWith(".mjs")))
	.sort();
const allTests = roots
	.flatMap((directory) =>
		walkFiles(directory, (file) => file.endsWith(".test.mjs")),
	)
	.sort();
const relativeTests = allTests.map((file) =>
	relative(root, file).replaceAll("\\", "/"),
);
const targetedTests = [
	"packages/action-registry/test/actions.test.mjs",
	"packages/agent-action-runtime/test/governed-action-runtime.test.mjs",
	"packages/agent-action-runtime/test/prisma-stores.test.mjs",
	"packages/integration-runtime/test/integration.test.mjs",
	"apps/agent/test/governed-action-execution.test.mjs",
	"apps/agent/test/governed-run-action-runtime.test.mjs",
	"apps/agent/test/legacy-agent-action-callsite-migration.test.mjs",
	"tools/quality/test/agent-action-boundary-audit.test.mjs",
	"scripts/tests/repository-audit.test.mjs",
];
const changedTypeScript = [
	"apps/agent/agent/lib/agent-actions.ts",
	"apps/agent/agent/lib/governed-run-actions.ts",
	"apps/agent/agent/lib/run-runtime.ts",
	"apps/agent/agent/subagents/agent_runner/tools/create_crm_activity.ts",
	"apps/agent/agent/subagents/agent_runner/tools/post_slack_message.ts",
	"apps/agent/src/governed-run-action-runtime.d.mts",
	"apps/agent/test/custom-agent-runtime.spec.ts",
	"apps/agent/test/durable-agent-runtime.integration.spec.ts",
];

const commands = [];
commands.push(syntaxSweep(allMjs));
commands.push(
	execute({
		label: "Changed TypeScript syntax check",
		command: process.execPath,
		args: ["tools/quality/check-typescript-syntax.mjs", ...changedTypeScript],
		classify(result) {
			if (result.status === 0) return { status: "passed", reason: null };
			if (result.status === 2)
				return {
					status: "not_available",
					reason: "TypeScript compiler API is unavailable",
				};
			return { status: "failed", reason: null };
		},
	}),
);
commands.push(
	execute({
		label: "Repository TypeScript syntax sweep",
		command: process.execPath,
		args: ["tools/quality/check-typescript-syntax.mjs"],
		timeoutMs: 300_000,
		classify(result) {
			if (result.status === 0) return { status: "passed", reason: null };
			if (result.status === 2)
				return {
					status: "not_available",
					reason: "TypeScript compiler API is unavailable",
				};
			return { status: "failed", reason: null };
		},
	}),
);
commands.push(
	execute({
		label: "Legacy callsite migration targeted suite",
		command: process.execPath,
		args: ["--test", "--test-concurrency=1", ...targetedTests],
	}),
);
commands.push(
	execute({
		label: "Dependency-free repository Node regression suite",
		command: process.execPath,
		args: ["--test", "--test-concurrency=1", ...relativeTests],
		timeoutMs: 300_000,
	}),
);
commands.push(
	execute({
		label: "Strict agent-action boundary audit",
		command: process.execPath,
		args: [
			"tools/quality/audit-agent-action-boundaries.mjs",
			"--check",
			"--strict-legacy",
		],
	}),
);
commands.push(
	execute({
		label: "Legacy callsite migration structural verifier",
		command: process.execPath,
		args: ["tools/release/verify-legacy-agent-action-migration.mjs"],
	}),
);
commands.push(
	execute({
		label: "Prior governed action repair regression gate",
		command: process.execPath,
		args: ["tools/release/verify-agent-action-repair.mjs"],
	}),
);
commands.push(
	execute({
		label: "Manifest verifier",
		command: process.execPath,
		args: ["scripts/verify-manifests.mjs"],
	}),
);
commands.push(
	execute({
		label: "Repository identity, secret, BOM and JSON audit",
		command: process.execPath,
		args: ["scripts/repository-audit.mjs"],
	}),
);
commands.push(
	execute({
		label: "Credential-vault configuration check",
		command: process.execPath,
		args: ["scripts/verify-security-config.mjs"],
	}),
);
commands.push(
	execute({
		label: "Tenant-boundary regression ratchet",
		command: process.execPath,
		args: ["scripts/audit-tenant-boundaries.mjs", "--check"],
	}),
);

const bun = execute({
	label: "Bun availability",
	command: "bun",
	args: ["--version"],
	critical: false,
});
commands.push(bun);
let nodeModulesPresent = false;
try {
	nodeModulesPresent = statSync(resolve(root, "node_modules")).isDirectory();
} catch {
	nodeModulesPresent = false;
}
if (bun.status === "passed" && nodeModulesPresent) {
	for (const script of ["format", "lint", "check-types", "test", "build"]) {
		commands.push(
			execute({
				label: `Full monorepo ${script}`,
				command: "bun",
				args: ["run", script],
				timeoutMs: 300_000,
			}),
		);
	}
} else {
	commands.push(
		unavailable(
			"Full Bun-backed formatter/lint/typecheck/test/build",
			`Not executed because Bun availability is ${bun.status} and node_modules is ${nodeModulesPresent ? "present" : "absent"}`,
		),
	);
}
commands.push(
	blockedExternal(
		"Isolated PostgreSQL migration and true multi-worker verification",
		process.env.TEST_DATABASE_URL
			? "TEST_DATABASE_URL exists, but generated Prisma/workspace dependencies are unavailable without dependency installation"
			: "TEST_DATABASE_URL was not provided; verification must never fall back to DATABASE_URL",
	),
);
commands.push(
	blockedExternal(
		"Live Slack provider and staging agent-run E2E",
		"Real Slack credentials, a staging deployment, queue/runtime infrastructure and authenticated tenant data are required",
	),
);

mkdirSync(qualityDirectory, { recursive: true });
const criticalFailures = commands.filter(
	(item) => item.critical && item.status !== "passed",
);
const statusCounts = commands.reduce((counts, item) => {
	counts[item.status] = (counts[item.status] ?? 0) + 1;
	return counts;
}, {});
const targetedTap =
	commands.find(
		(item) => item.label === "Legacy callsite migration targeted suite",
	)?.tap ?? null;
const broadTap =
	commands.find(
		(item) => item.label === "Dependency-free repository Node regression suite",
	)?.tap ?? null;
const report = {
	stage: "AGENT-ACTION-INTEGRATION-004-LEGACY-CALLSITE-MIGRATION",
	scopeId: "AGENT-ACTION-INTEGRATION-004-LEGACY-CALLSITE-MIGRATION",
	nextScopeId:
		criticalFailures.length === 0
			? "CRM-PIPE-API-003"
			: "AGENT-ACTION-INTEGRATION-004-LEGACY-CALLSITE-MIGRATION-REPAIR",
	artifactState:
		criticalFailures.length === 0
			? "VERIFIED_CHECKPOINT"
			: "DIAGNOSTIC_CHECKPOINT",
	criticalChecksPassed: criticalFailures.length === 0,
	generatedAt: new Date().toISOString(),
	environment: {
		node: process.version,
		platform: process.platform,
		architecture: process.arch,
		bun: bun.status === "passed" ? bun.stdout.trim() : null,
		nodeModulesPresent,
		testDatabaseConfigured: Boolean(process.env.TEST_DATABASE_URL),
	},
	discovery: {
		esmFilesChecked: allMjs.length,
		dependencyFreeTestFiles: allTests.length,
		changedTypeScriptFiles: changedTypeScript.length,
	},
	testSummary: { targeted: targetedTap, broadDependencyFree: broadTap },
	commandStatusCounts: statusCounts,
	criticalFailures: criticalFailures.map((item) => ({
		label: item.label,
		status: item.status,
		reason: item.reason,
	})),
	commands: commands.map(serializeCommand),
	verificationLimits: [
		"Full dependency-backed formatter, semantic typecheck, workspace tests and production build require Bun plus installed dependencies.",
		"Prisma/PostgreSQL transaction, migration and multi-worker behavior require an isolated TEST_DATABASE_URL and generated client.",
		"Live Slack delivery, timeout reconciliation and authenticated staging E2E require provider credentials and deployed infrastructure.",
		"The current server-owned WORKSPACE_ID reflects the repository's legacy single-workspace deployment model; end-to-end multi-tenant migration remains tracked separately.",
	],
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
const log = buildLog(commands);
writeFileSync(reportPath, serialized, "utf8");
writeFileSync(buildLogPath, log, "utf8");
writeFileSync(generalReportPath, serialized, "utf8");
writeFileSync(generalBuildLogPath, log, "utf8");

console.log(
	JSON.stringify({
		criticalChecksPassed: report.criticalChecksPassed,
		artifactState: report.artifactState,
		nextScopeId: report.nextScopeId,
		statusCounts,
		targetedTests: targetedTap,
		broadTests: broadTap,
		report: relative(root, reportPath).replaceAll("\\", "/"),
		buildLog: relative(root, buildLogPath).replaceAll("\\", "/"),
	}),
);
if (!report.criticalChecksPassed) process.exitCode = 1;
