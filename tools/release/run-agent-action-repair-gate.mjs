#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import process from "node:process";

const root = resolve(process.cwd());
const qualityDirectory = resolve(root, "docs/quality");
const reportPath = resolve(qualityDirectory, "generated-agent-action-repair-report.json");
const buildLogPath = resolve(qualityDirectory, "generated-agent-action-repair-build.log");
const generalReportPath = resolve(qualityDirectory, "generated-build-report.json");
const generalBuildLogPath = resolve(qualityDirectory, "generated-build.log");
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 120_000;

function walkFiles(directory, predicate, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && [".git", ".next", ".turbo", "coverage", "dist", "node_modules"].includes(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(absolute, predicate, output);
    else if (entry.isFile() && predicate(absolute)) output.push(absolute);
  }
  return output;
}

function commandText(command, args) {
  return [command, ...args].map((part) => (/^[A-Za-z0-9_./:@=-]+$/.test(part) ? part : JSON.stringify(part))).join(" ");
}

function parseTap(output) {
  function lastNumber(label) {
    const matches = [...output.matchAll(new RegExp(`^# ${label} (\\d+)$`, "gm"))];
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

function execute({ label, command, args = [], critical = true, timeoutMs = COMMAND_TIMEOUT_MS, classification }) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: MAX_BUFFER_BYTES,
    timeout: timeoutMs,
  });
  const durationMs = Date.now() - startedAt;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  let status;
  let reason = null;

  if (classification) {
    ({ status, reason } = classification(result));
  } else if (result.error?.code === "ENOENT") {
    status = "not_available";
    reason = `${command} is not installed in the verification environment`;
  } else if (result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM") {
    status = "timeout";
    reason = `Command exceeded ${timeoutMs}ms`;
  } else {
    status = result.status === 0 ? "passed" : "failed";
  }

  return {
    label,
    command: commandText(command, args),
    status,
    critical,
    exitCode: result.status,
    signal: result.signal ?? null,
    durationMs,
    reason,
    stdout,
    stderr,
    tap: command === process.execPath && args.includes("--test") ? parseTap(`${stdout}\n${stderr}`) : null,
  };
}

function unavailable(label, reason) {
  return {
    label,
    command: null,
    status: "not_available",
    critical: false,
    exitCode: null,
    signal: null,
    durationMs: 0,
    reason,
    stdout: "",
    stderr: "",
    tap: null,
  };
}

function blockedExternal(label, reason) {
  return {
    label,
    command: null,
    status: "blocked_external",
    critical: false,
    exitCode: null,
    signal: null,
    durationMs: 0,
    reason,
    stdout: "",
    stderr: "",
    tap: null,
  };
}

function runSyntaxSweep(files) {
  const startedAt = Date.now();
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
      failures.push({ file, exitCode: result.status, error: result.error?.message ?? null, stdout: result.stdout ?? "", stderr: result.stderr ?? "" });
    }
  }
  return {
    label: "All repository ESM syntax checks",
    command: `node --check <${files.length} discovered .mjs files>`,
    status: failures.length === 0 ? "passed" : "failed",
    critical: true,
    exitCode: failures.length === 0 ? 0 : 1,
    signal: null,
    durationMs: Date.now() - startedAt,
    reason: failures.length === 0 ? null : `${failures.length} ESM file(s) failed syntax validation`,
    stdout: JSON.stringify({ checkedFiles: files.length, failures }, null, 2),
    stderr: "",
    tap: null,
  };
}

function serializeCommand(item) {
  const { stdout, stderr, ...metadata } = item;
  return {
    ...metadata,
    stdoutTail: stdout.slice(-8_000),
    stderrTail: stderr.slice(-8_000),
  };
}

function buildLog(commands) {
  const sections = [];
  for (const item of commands) {
    sections.push(`===== ${item.label} =====`);
    sections.push(item.command ? `$ ${item.command}` : "$ <not executed>");
    sections.push(`status=${item.status} critical=${item.critical} rc=${item.exitCode ?? "null"} durationMs=${item.durationMs}`);
    if (item.reason) sections.push(`reason=${item.reason}`);
    if (item.stdout) sections.push(item.stdout.trimEnd());
    if (item.stderr) sections.push(item.stderr.trimEnd());
    sections.push("");
  }
  return `${sections.join("\n")}\n`;
}

const sourceRoots = ["packages", "scripts", "tools", "apps"].map((item) => resolve(root, item));
const allMjs = sourceRoots.flatMap((directory) => walkFiles(directory, (file) => file.endsWith(".mjs"))).sort();
const allTests = sourceRoots.flatMap((directory) => walkFiles(directory, (file) => file.endsWith(".test.mjs"))).sort();
const relativeTests = allTests.map((file) => relative(root, file).replaceAll("\\", "/"));
const targetedTests = [
  "packages/action-registry/test/actions.test.mjs",
  "packages/agent-action-runtime/test/governed-action-runtime.test.mjs",
  "packages/agent-action-runtime/test/prisma-stores.test.mjs",
  "packages/integration-runtime/test/integration.test.mjs",
  "apps/agent/test/governed-action-execution.test.mjs",
  "tools/quality/test/agent-action-boundary-audit.test.mjs",
  "scripts/tests/repository-audit.test.mjs",
];

const commands = [];
commands.push(runSyntaxSweep(allMjs));
commands.push(execute({
  label: "Governed action repair targeted suite",
  command: process.execPath,
  args: ["--test", ...targetedTests],
}));
commands.push(execute({
  label: "Pipeline runtime public-error regression suite",
  command: process.execPath,
  args: ["--test", "packages/pipeline-runtime/test/runtime.test.mjs"],
}));
commands.push(execute({
  label: "Dependency-free repository Node regression suite",
  command: process.execPath,
  args: ["--test", ...relativeTests],
}));
commands.push(execute({
  label: "Agent action boundary audit",
  command: process.execPath,
  args: ["tools/quality/audit-agent-action-boundaries.mjs", "--check"],
}));
commands.push(execute({
  label: "Agent action repair structural verifier",
  command: process.execPath,
  args: ["tools/release/verify-agent-action-repair.mjs"],
}));
commands.push(execute({
  label: "R11-R12 structural verifier",
  command: process.execPath,
  args: ["tools/release/verify-r11-r12.mjs"],
}));
commands.push(execute({
  label: "Manifest verifier",
  command: process.execPath,
  args: ["scripts/verify-manifests.mjs"],
}));
commands.push(execute({
  label: "Repository identity, secret, BOM and JSON audit",
  command: process.execPath,
  args: ["scripts/repository-audit.mjs"],
}));
commands.push(execute({
  label: "Credential-vault configuration check",
  command: process.execPath,
  args: ["scripts/verify-security-config.mjs"],
}));
commands.push(execute({
  label: "Tenant-boundary regression ratchet",
  command: process.execPath,
  args: ["scripts/audit-tenant-boundaries.mjs", "--check"],
}));
commands.push(execute({
  label: "Strict legacy agent-action migration audit",
  command: process.execPath,
  args: ["tools/quality/audit-agent-action-boundaries.mjs", "--check", "--strict-legacy"],
  critical: true,
  classification(result) {
    if (result.error?.code === "ENOENT") return { status: "not_available", reason: "Node is unavailable" };
    if (result.status === 0) return { status: "passed", reason: "All legacy dispatch sites have been migrated" };
    return {
      status: "failed",
      reason: "Legacy agent-action dispatch remains outside the governed execution boundary",
    };
  },
}));

const bunResult = execute({
  label: "Bun availability",
  command: "bun",
  args: ["--version"],
  critical: false,
});
commands.push(bunResult);
const hasNodeModules = (() => {
  try { return statSync(resolve(root, "node_modules")).isDirectory(); }
  catch { return false; }
})();
if (bunResult.status === "passed" && hasNodeModules) {
  for (const script of ["lint", "check-types", "test", "build"]) {
    commands.push(execute({ label: `Full monorepo ${script}`, command: "bun", args: ["run", script], critical: true, timeoutMs: 300_000 }));
  }
} else {
  commands.push(unavailable(
    "Full Bun-backed monorepo lint/typecheck/test/build",
    `Not executed because Bun availability is ${bunResult.status} and node_modules is ${hasNodeModules ? "present" : "absent"}`,
  ));
}
commands.push(blockedExternal(
  "Isolated PostgreSQL migration and multi-worker action-state verification",
  process.env.TEST_DATABASE_URL
    ? "A TEST_DATABASE_URL exists, but the generated Prisma client/workspace dependency graph is unavailable without the Bun installation step"
    : "TEST_DATABASE_URL was not provided; the suite must never fall back to DATABASE_URL",
));
commands.push(blockedExternal(
  "Live provider reconciliation and staging tenant/authentication E2E",
  "Real provider credentials, staging deployment, queues and tenant sessions are required",
));

mkdirSync(qualityDirectory, { recursive: true });
const criticalFailures = commands.filter((item) => item.critical && item.status !== "passed");
const statusCounts = commands.reduce((counts, item) => {
  counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}, {});
const targetedTap = commands.find((item) => item.label === "Governed action repair targeted suite")?.tap ?? null;
const broadTap = commands.find((item) => item.label === "Dependency-free repository Node regression suite")?.tap ?? null;
const boundaryOutput = commands.find((item) => item.label === "Agent action boundary audit")?.stdout ?? "";
let boundaryFindings = null;
try { boundaryFindings = JSON.parse(boundaryOutput); } catch { boundaryFindings = null; }

const report = {
  stage: "AGENT-ACTION-INTEGRATION-002-REPAIR",
  scopeId: "AGENT-ACTION-INTEGRATION-002-REPAIR",
  nextScopeId: criticalFailures.length === 0
    ? "CRM-PIPE-API-003"
    : "AGENT-ACTION-INTEGRATION-002-REPAIR",
  artifactState: criticalFailures.length === 0 ? "VERIFIED_BATCH" : "DIAGNOSTIC_BATCH",
  criticalChecksPassed: criticalFailures.length === 0,
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    bun: bunResult.status === "passed" ? bunResult.stdout.trim() : null,
    nodeModulesPresent: hasNodeModules,
    testDatabaseConfigured: Boolean(process.env.TEST_DATABASE_URL),
  },
  discovery: {
    esmFilesChecked: allMjs.length,
    dependencyFreeTestFiles: allTests.length,
  },
  testSummary: {
    targeted: targetedTap,
    broadDependencyFree: broadTap,
  },
  commandStatusCounts: statusCounts,
  criticalFailures: criticalFailures.map((item) => ({ label: item.label, status: item.status, reason: item.reason })),
  boundaryAudit: boundaryFindings,
  commands: commands.map(serializeCommand),
  verificationLimits: [
    "Bun-backed full monorepo lint, typecheck, workspace tests and build require Bun plus installed dependencies.",
    "The additive governed-action migration requires isolated PostgreSQL application and true concurrent-worker verification.",
    "Live ambiguous-outcome reconciliation requires real provider credentials and staging infrastructure.",
    "Legacy run-action call sites are covered by the strict governed-boundary audit.",
  ],
};
const log = buildLog(commands);
const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(reportPath, serializedReport, "utf8");
writeFileSync(buildLogPath, log, "utf8");
writeFileSync(generalReportPath, serializedReport, "utf8");
writeFileSync(generalBuildLogPath, log, "utf8");

console.log(JSON.stringify({
  criticalChecksPassed: report.criticalChecksPassed,
  artifactState: report.artifactState,
  nextScopeId: report.nextScopeId,
  statusCounts,
  targetedTests: targetedTap,
  broadTests: broadTap,
  report: relative(root, reportPath).replaceAll("\\", "/"),
  buildLog: relative(root, buildLogPath).replaceAll("\\", "/"),
}));
if (!report.criticalChecksPassed) process.exitCode = 1;
