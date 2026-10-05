#!/usr/bin/env node
/** Evidence for local checks only. Does not start a database or call a provider. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTestSummary, hasCompleteTestEvidence } from "../quality/lib/test-evidence.mjs";
const root = resolve(import.meta.dirname, "../..");
const output = resolve(root, "docs/quality");
const stages = [
  ["Dependency-free regression", "tools/quality/run-local-tests.mjs"],
  ["All ESM syntax", "tools/quality/check-esm.mjs"],
  ["TypeScript parser sweep (not semantic typecheck)", "tools/quality/check-typescript-syntax.mjs"],
  ["Package manifests", "scripts/verify-manifests.mjs"],
  ["Workspace lock metadata (not frozen install)", "tools/quality/verify-workspace-lock.mjs"],
  ["Generated appearance tokens current", "tools/quality/generate-appearance.mjs", "--check"],
  ["Repository identity/secrets/BOM audit", "scripts/repository-audit.mjs"],
  ["Credential configuration contract", "scripts/verify-security-config.mjs"],
  ["Tenant-boundary ratchet (existing findings remain)", "scripts/audit-tenant-boundaries.mjs", "--check"],
  ["Strict governed-action boundary", "tools/quality/audit-agent-action-boundaries.mjs", "--check", "--strict-legacy"],
  ["Legacy action migration structure", "tools/release/verify-legacy-agent-action-migration.mjs"],
  ["Pipeline API structure", "tools/release/verify-pipeline-api-r3.mjs"],
  ["Dual-write structure", "tools/release/verify-pipeline-dual-write-r4.mjs"],
  ["PostgreSQL gate structure (no DB execution)", "tools/release/verify-pipeline-postgres-r5.mjs"],
  ["Migration persistence structure", "tools/release/verify-migration-persistence-r13.mjs"],
];
const commands = [], logs = [];
for (const [label, ...args] of stages) {
  const startedAt = new Date();
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", env: process.env, timeout: 300000, maxBuffer: 32 * 1024 * 1024 });
  const stdout = result.stdout ?? "", stderr = result.stderr ?? "";
  const command = { label, command: `node ${args.join(" ")}`, status: result.status === 0 && !result.error ? "passed" : "failed", exitCode: result.status, durationMs: Date.now() - startedAt.getTime(), startedAt: startedAt.toISOString(), error: result.error?.message ?? null };
  if (label === "Dependency-free regression") {
    command.testSummary = parseTestSummary(stdout);
    if (!hasCompleteTestEvidence(command.testSummary)) command.status = "failed";
  }
  command.stdoutTail = stdout.slice(-6000);
  command.stderrTail = stderr.slice(-6000);
  commands.push(command);
  logs.push(`\n===== ${label} =====\n${command.command}\nstatus=${command.status} exit=${command.exitCode}\n${stdout}\n${stderr}`);
  console.log(`${command.status.toUpperCase()} ${label}`);
}
const passed = commands.every(command => command.status === "passed");
const report = {
  scopeId: "MASTER-SOURCE-WORKER-2026-09-18", generatedAt: new Date().toISOString(),
  status: passed ? "VERIFIED" : "FAILED", verificationLevel: "Local dependency-free runtime tests, syntax and structural checks only", wholeProductProductionReady: false,
  environment: { node: process.version, platform: process.platform, architecture: process.arch, workspaceDependencyTree: existsSync(resolve(root, "node_modules/.bin")) },
  commands,
  notVerifiedByThisGate: ["Bun frozen install", "formatter/lint", "semantic monorepo typecheck", "Prisma generation and real PostgreSQL concurrency", "production build", "authenticated Next/tRPC E2E", "live providers", "shared-database tenant isolation", "full accessibility", "LLM evaluation", "production backup/restore/load"],
  nextScopeId: "CRM-PIPE-POSTGRES-005",
};
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "generated-master-local-report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(resolve(output, "generated-master-local-build.log"), `${logs.join("\n")}\n`);
if (!passed) process.exitCode = 1;
