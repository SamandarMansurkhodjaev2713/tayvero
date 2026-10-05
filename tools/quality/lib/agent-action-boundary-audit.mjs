import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);
const EXCLUDED_DIRECTORIES = new Set([
	".git",
	".next",
	".turbo",
	"build",
	"coverage",
	"dist",
	"fixtures",
	"node_modules",
	"snapshots",
	"test",
	"tests",
	"__tests__",
]);
const ALLOWED_EXECUTOR_BOUNDARIES = new Set([
	"packages/agent-action-runtime/src/index.mjs",
]);
const ALLOWED_RUN_SIDE_EFFECT_BOUNDARIES = new Set([
	"apps/agent/agent/lib/governed-run-actions.ts",
	"apps/agent/agent/lib/run-runtime.ts",
]);
const RUN_SIDE_EFFECT_SYMBOLS = [
	"executeRunActivitySideEffect",
	"executeRunSlackMessageSideEffect",
];
const LEGACY_RUN_ACTION_SYMBOLS = ["createRunActivity", "postRunSlackMessage"];
const LEGACY_REGISTRY_SYMBOLS = [
	"InMemoryActionState",
	"actionPayloadHash",
	"issueApproval",
	"verifyApproval",
];

function normalizePath(value) {
	return value.split(sep).join("/");
}

function lineNumber(source, index) {
	return source.slice(0, index).split("\n").length;
}

function finding({ code, severity, file, source, match, message }) {
	return Object.freeze({
		code,
		severity,
		file,
		line: lineNumber(source, match.index ?? 0),
		message,
	});
}

async function* walk(directory) {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error?.code === "ENOENT") return;
		throw error;
	}
	for (const entry of entries) {
		if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
		const absolute = resolve(directory, entry.name);
		if (entry.isDirectory()) yield* walk(absolute);
		else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)))
			yield absolute;
	}
}

function scanSource(file, source) {
	const findings = [];
	const actionRegistryImport =
		/(?:from\s*|import\s*\()["'][^"']*action-registry[^"']*["']/g;
	const importsRegistry = actionRegistryImport.test(source);

	if (importsRegistry) {
		for (const symbol of LEGACY_REGISTRY_SYMBOLS) {
			const match = new RegExp(`\\b${symbol}\\b`).exec(source);
			if (match) {
				findings.push(
					finding({
						code: "LEGACY_ACTION_REGISTRY_EXECUTION_API",
						severity: "error",
						file,
						source,
						match,
						message: `${symbol} belongs to the removed parallel execution engine; use the governed runtime stores and approvals`,
					}),
				);
			}
		}

		const legacyOptions =
			/createActionRegistry\s*\(\s*\{[\s\S]{0,800}?\b(?:state|approvalSecret|leaseMs)\s*:/g.exec(
				source,
			);
		if (legacyOptions) {
			findings.push(
				finding({
					code: "LEGACY_ACTION_REGISTRY_EXECUTION_OPTIONS",
					severity: "error",
					file,
					source,
					match: legacyOptions,
					message:
						"Action registry execution state is forbidden; the registry must remain catalog-only",
				}),
			);
		}

		const registryExecute =
			/\b(?:actionRegistry|registry)\s*\.\s*execute\s*\(/g.exec(source);
		if (registryExecute) {
			findings.push(
				finding({
					code: "DIRECT_ACTION_REGISTRY_EXECUTION",
					severity: "error",
					file,
					source,
					match: registryExecute,
					message:
						"Direct action-registry execution bypasses the governed action runtime",
				}),
			);
		}
	}

	if (!ALLOWED_EXECUTOR_BOUNDARIES.has(file)) {
		// Any invocation through an `.executor(...)` property bypasses the governed
		// policy/approval/idempotency boundary, regardless of the local variable name.
		const directExecutor = /\.\s*executor\s*\(/g.exec(source);
		if (directExecutor) {
			findings.push(
				finding({
					code: "DIRECT_ACTION_EXECUTOR_CALL",
					severity: "error",
					file,
					source,
					match: directExecutor,
					message:
						"Action executor calls are allowed only inside packages/agent-action-runtime",
				}),
			);
		}
	}

	if (!ALLOWED_RUN_SIDE_EFFECT_BOUNDARIES.has(file)) {
		for (const symbol of RUN_SIDE_EFFECT_SYMBOLS) {
			const directRunSideEffect = new RegExp(`\\b${symbol}\\s*\\(`, "g").exec(
				source,
			);
			if (directRunSideEffect) {
				findings.push(
					finding({
						code: "DIRECT_RUN_ACTION_SIDE_EFFECT",
						severity: "error",
						file,
						source,
						match: directRunSideEffect,
						message: `${symbol} may be invoked only by apps/agent/agent/lib/governed-run-actions.ts`,
					}),
				);
			}
		}
	}

	for (const symbol of LEGACY_RUN_ACTION_SYMBOLS) {
		const legacyCall = new RegExp(`\\b${symbol}\\b`, "g").exec(source);
		if (legacyCall) {
			findings.push(
				finding({
					code: "LEGACY_RUN_ACTION_ENTRYPOINT",
					severity: "migration",
					file,
					source,
					match: legacyCall,
					message: `${symbol} bypasses the governed run-action entrypoint and must not remain in production source`,
				}),
			);
		}
	}

	const legacyRuntime = /\bAGENT_ACTION_EXECUTORS\b/g.exec(source);
	if (legacyRuntime) {
		findings.push(
			finding({
				code: "LEGACY_AGENT_ACTION_DISPATCH",
				severity: "migration",
				file,
				source,
				match: legacyRuntime,
				message:
					"Legacy agent action dispatch remains and must be migrated through createAgentActionExecutionService",
			}),
		);
	}

	return findings;
}

export async function auditAgentActionBoundaries(rootDirectory) {
	const root = resolve(rootDirectory);
	const findings = [];
	for (const sourceRoot of [
		resolve(root, "apps", "agent"),
		resolve(root, "packages"),
	]) {
		for await (const absolute of walk(sourceRoot)) {
			const file = normalizePath(relative(root, absolute));
			if (file === "tools/quality/audit-agent-action-boundaries.mjs") continue;
			const source = await readFile(absolute, "utf8");
			findings.push(...scanSource(file, source));
		}
	}
	findings.sort(
		(left, right) =>
			left.file.localeCompare(right.file) ||
			left.line - right.line ||
			left.code.localeCompare(right.code),
	);
	return Object.freeze(findings);
}

export function summarizeAgentActionBoundaryFindings(findings) {
	const counts = { error: 0, migration: 0, review: 0 };
	for (const item of findings)
		counts[item.severity] = (counts[item.severity] ?? 0) + 1;
	return Object.freeze(counts);
}
