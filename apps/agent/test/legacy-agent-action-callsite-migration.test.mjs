import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditAgentActionBoundaries } from "../../../tools/quality/lib/agent-action-boundary-audit.mjs";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

async function source(relativePath) {
	return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("agent runner tools invoke only the governed run-action bridge", async () => {
	const activityTool = await source(
		"apps/agent/agent/subagents/agent_runner/tools/create_crm_activity.ts",
	);
	const slackTool = await source(
		"apps/agent/agent/subagents/agent_runner/tools/post_slack_message.ts",
	);

	assert.match(activityTool, /createGovernedRunActivity/);
	assert.match(activityTool, /ctx\.abortSignal/);
	assert.doesNotMatch(
		activityTool,
		/createRunActivity|executeRunActivitySideEffect/,
	);

	assert.match(slackTool, /postGovernedRunSlackMessage/);
	assert.match(slackTool, /ctx\.abortSignal/);
	assert.doesNotMatch(
		slackTool,
		/postRunSlackMessage|executeRunSlackMessageSideEffect/,
	);
});

test("the governed bridge is the sole production caller of low-level run side effects", async () => {
	const findings = await auditAgentActionBoundaries(repositoryRoot);
	assert.deepEqual(findings, []);

	const bridge = await source("apps/agent/agent/lib/governed-run-actions.ts");
	assert.match(bridge, /createGovernedRunActionRuntime/);
	assert.match(bridge, /executeRunActivitySideEffect/);
	assert.match(bridge, /executeRunSlackMessageSideEffect/);
	assert.match(bridge, /WORKSPACE_ID/);
	assert.match(bridge, /parseAgentManifest/);
	assert.match(
		bridge,
		/request\.context\.requestId\s*===\s*runRequestId\(run\.id, request\.callId\)/,
	);
});

test("run-runtime requires the governed envelope and no longer exposes legacy entrypoints", async () => {
	const runtime = await source("apps/agent/agent/lib/run-runtime.ts");
	assert.match(runtime, /GovernedRunActionExecution/);
	assert.match(runtime, /operationDigest/);
	assert.match(runtime, /idempotencyKey/);
	assert.match(runtime, /throwIfGovernedRunActionAborted/);
	assert.match(runtime, /failRunActionOrPreserveEvidence/);
	assert.match(runtime, /failed\.count !== 1/);
	assert.doesNotMatch(runtime, /export async function createRunActivity\b/);
	assert.doesNotMatch(runtime, /export async function postRunSlackMessage\b/);
	assert.doesNotMatch(runtime, /AGENT_ACTION_EXECUTORS/);
});

test("run.summary remains a run-control capability instead of becoming an external side effect", async () => {
	const capabilities = await source("apps/agent/agent/lib/agent-actions.ts");
	assert.match(
		capabilities,
		/RUN_SUMMARY[\s\S]*executionMode:\s*"RUN_CONTROL"/,
	);
	assert.match(
		capabilities,
		/CRM_ACTIVITY_CREATE[\s\S]*executionMode:\s*"GOVERNED"/,
	);
	assert.match(
		capabilities,
		/SLACK_MESSAGE_POST[\s\S]*executionMode:\s*"GOVERNED"/,
	);
});
