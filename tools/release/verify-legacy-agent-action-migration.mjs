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
  "apps/agent/agent/lib/agent-actions.ts",
  "apps/agent/agent/lib/governed-run-actions.ts",
  "apps/agent/agent/lib/run-runtime.ts",
  "apps/agent/agent/subagents/agent_runner/tools/create_crm_activity.ts",
  "apps/agent/agent/subagents/agent_runner/tools/post_slack_message.ts",
  "apps/agent/src/governed-run-action-runtime.mjs",
  "apps/agent/src/governed-run-action-runtime.d.mts",
  "apps/agent/test/governed-run-action-runtime.test.mjs",
  "apps/agent/test/legacy-agent-action-callsite-migration.test.mjs",
  "packages/action-registry/src/registry.mjs",
  "packages/agent-action-runtime/src/index.mjs",
  "tools/quality/check-typescript-syntax.mjs",
  "tools/quality/lib/agent-action-boundary-audit.mjs",
  "tools/release/run-legacy-agent-action-migration-gate.mjs",
  "docs/architecture/agent-run-action-execution.md",
  "docs/architecture/action-registry.md",
  "docs/adr/0009-governed-agent-run-action-entrypoint.md",
  "docs/implementation/MASTER_SCOPE.md",
  "DELIVERY_LEGACY_AGENT_ACTION_MIGRATION.md",
  "progress.md",
  "qa.md",
];

const productionFilesWithoutPlaceholders = [
  "apps/agent/agent/lib/agent-actions.ts",
  "apps/agent/agent/lib/governed-run-actions.ts",
  "apps/agent/agent/lib/run-runtime.ts",
  "apps/agent/agent/subagents/agent_runner/tools/create_crm_activity.ts",
  "apps/agent/agent/subagents/agent_runner/tools/post_slack_message.ts",
  "apps/agent/src/governed-run-action-runtime.mjs",
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
  assert(await exists(file), `Required migration file is missing: ${file}`);
}

const rootManifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
for (const script of [
  "test:legacy-agent-action-migration",
  "verify:legacy-agent-action-migration",
  "gate:legacy-agent-action-migration",
]) {
  assert(typeof rootManifest.scripts?.[script] === "string", `Root script ${script} is missing`);
}

const agentManifest = JSON.parse(await readFile(resolve(root, "apps/agent/package.json"), "utf8"));
assert(agentManifest.dependencies?.["@crm/action-registry"] === "workspace:*", "Agent app is missing @crm/action-registry workspace dependency");
assert(agentManifest.dependencies?.["@crm/agent-action-runtime"] === "workspace:*", "Agent app is missing @crm/agent-action-runtime workspace dependency");

const capabilities = await readFile(resolve(root, "apps/agent/agent/lib/agent-actions.ts"), "utf8");
assert(capabilities.includes('executionMode: "GOVERNED"'), "Governed action capability metadata is missing");
assert(capabilities.includes('executionMode: "RUN_CONTROL"'), "Run-control capability metadata is missing");
assert(!capabilities.includes("AGENT_ACTION_EXECUTORS"), "Legacy executor map still exists");

const bridge = await readFile(resolve(root, "apps/agent/agent/lib/governed-run-actions.ts"), "utf8");
for (const required of [
  "createGovernedRunActionRuntime",
  "executeRunActivitySideEffect",
  "executeRunSlackMessageSideEffect",
  "parseAgentManifest",
  "request.context.requestId === runRequestId(run.id, request.callId)",
]) {
  assert(bridge.includes(required), `Governed run bridge is missing invariant: ${required}`);
}

const runtime = await readFile(resolve(root, "apps/agent/src/governed-run-action-runtime.mjs"), "utf8");
for (const required of [
  "snapshotPlainDataRecord",
  "IDENTIFIER_PATTERN",
  "idempotencyKey: actionIdempotencyKey(normalized.runId, normalized.callId)",
  "operationDigest: execution.operationDigest",
  "assertPolicyDecision",
]) {
  assert(runtime.includes(required), `Governed run runtime is missing invariant: ${required}`);
}

const lowLevelRuntime = await readFile(resolve(root, "apps/agent/agent/lib/run-runtime.ts"), "utf8");
for (const required of [
  "GovernedRunActionExecution",
  "executeRunActivitySideEffect",
  "executeRunSlackMessageSideEffect",
  "failRunActionOrPreserveEvidence",
  "failed.count !== 1",
]) {
  assert(lowLevelRuntime.includes(required), `Low-level run runtime is missing invariant: ${required}`);
}
for (const forbidden of [
  "export async function createRunActivity",
  "export async function postRunSlackMessage",
  "AGENT_ACTION_EXECUTORS",
]) {
  assert(!lowLevelRuntime.includes(forbidden), `Legacy run-runtime entrypoint remains: ${forbidden}`);
}

const activityTool = await readFile(resolve(root, "apps/agent/agent/subagents/agent_runner/tools/create_crm_activity.ts"), "utf8");
const slackTool = await readFile(resolve(root, "apps/agent/agent/subagents/agent_runner/tools/post_slack_message.ts"), "utf8");
assert(activityTool.includes("createGovernedRunActivity") && activityTool.includes("ctx.abortSignal"), "CRM activity tool is not connected to governed execution with cancellation");
assert(slackTool.includes("postGovernedRunSlackMessage") && slackTool.includes("ctx.abortSignal"), "Slack tool is not connected to governed execution with cancellation");
for (const source of [activityTool, slackTool]) {
  assert(!/\b(?:createRunActivity|postRunSlackMessage|executeRunActivitySideEffect|executeRunSlackMessageSideEffect)\b/u.test(source), "Agent tool still calls a legacy or low-level side-effect entrypoint");
}

for (const file of productionFilesWithoutPlaceholders) {
  const source = await readFile(resolve(root, file), "utf8");
  assert(!/\b(?:TODO|FIXME)\b/u.test(source), `Unresolved placeholder remains in ${file}`);
}

const ledger = await readFile(resolve(root, "docs/implementation/MASTER_SCOPE.md"), "utf8");
assert(
  /AGENT-ACTION-INTEGRATION-004-LEGACY-CALLSITE-MIGRATION[^\n]*IMPLEMENTED[^\n]*INTEGRATION_VERIFIED/u.test(ledger),
  "MASTER_SCOPE does not mark the connected migration with supported implementation and verification statuses",
);
assert(ledger.includes("NEXT_SCOPE_ID: `CRM-PIPE-API-003`"), "MASTER_SCOPE next scope is not CRM-PIPE-API-003");

const findings = await auditAgentActionBoundaries(root);
const counts = summarizeAgentActionBoundaryFindings(findings);
assert(counts.error === 0, `Action boundary audit has ${counts.error} blocking finding(s)`);
assert(counts.migration === 0, `Action boundary audit has ${counts.migration} legacy migration finding(s)`);

console.log(JSON.stringify({
  ok: true,
  requiredFiles: requiredFiles.length,
  blockingBoundaryFindings: counts.error,
  legacyMigrationFindings: counts.migration,
  nextScopeId: "CRM-PIPE-API-003",
}));
