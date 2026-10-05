#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import {
  auditAgentActionBoundaries,
  summarizeAgentActionBoundaryFindings,
} from "./lib/agent-action-boundary-audit.mjs";

const root = resolve(process.cwd());
const check = process.argv.includes("--check");
const strictLegacy = process.argv.includes("--strict-legacy");
const reportPath = resolve(root, "docs/quality/generated-agent-action-boundary-audit.json");
const findings = await auditAgentActionBoundaries(root);
const counts = summarizeAgentActionBoundaryFindings(findings);
const report = {
  generatedAt: new Date().toISOString(),
  findingCount: findings.length,
  errorCount: counts.error,
  migrationCount: counts.migration,
  findings,
  policy: {
    checkFailsOn: strictLegacy ? ["error", "migration"] : ["error"],
    testsAndFixturesExcluded: true,
    soleExecutorBoundary: "packages/agent-action-runtime/src/index.mjs",
  },
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

const blocking = findings.filter((item) => item.severity === "error" || (strictLegacy && item.severity === "migration"));
if (check && blocking.length > 0) process.exitCode = 1;
