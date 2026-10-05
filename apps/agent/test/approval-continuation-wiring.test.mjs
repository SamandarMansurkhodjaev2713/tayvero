/** Structural regressions only: native Eve compatibility still requires runtime acceptance. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseJsonc } from "../../../tools/quality/lib/workspace-lock.mjs";

const text = (p) =>
	readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
test("both native mutation tools preserve disabled-default behavior before parsing optional input", () => {
	for (const name of ["create_crm_activity", "post_slack_message"]) {
		const source = text(
			`apps/agent/agent/subagents/agent_runner/tools/${name}.ts`,
		);
		const disabledGate = source.search(
			/if\s*\(!continuationEnabled\(\)\)\s*return false/,
		);
		const parseInput = source.indexOf("actionInput.safeParse(ctx.toolInput)");
		assert.ok(disabledGate >= 0, "disabled continuation gate must be present");
		assert.ok(parseInput >= 0, "optional input parsing must be present");
		assert.ok(
			disabledGate < parseInput,
			"disabled gate must run before parsing",
		);
		assert.match(source, /ctx\.session\.id/);
		assert.match(source, /approval:\s*\(?ctx\)?\s*=>/);
	}
	assert.match(
		text(".env.example"),
		/^AGENT_APPROVAL_CONTINUATION_ENABLED=0$/m,
	);
});
test("native event journal observer is wired outside the best-effort audit catch", () => {
	const hook = text("apps/agent/agent/hooks/audit.ts");
	assert.ok(
		hook.indexOf("await observeNativeApprovalEvent(event, ctx)") <
			hook.indexOf("try {"),
	);
	assert.match(
		text("apps/agent/agent/schedules/dispatch.ts"),
		/await drainApprovalContinuations\(/,
	);
	assert.match(
		text("apps/agent/agent/channels/eve.ts"),
		/withAuthChallenges\(authenticateNativeContinuation/,
	);
});
test("timeout confirmation remains inside the locked transaction and completion cannot skip pending consent", () => {
	const timeout = text("apps/agent/agent/lib/custom-agent-dispatch.ts")
		.split("export async function failRun")[1]
		.split("export async function cancelRun")[0];
	assert.ok(
		timeout.indexOf("await lockAgentRun") <
			timeout.indexOf("executionBudgetExpired"),
	);
	assert.ok(
		timeout.indexOf("executionBudgetExpired") <
			timeout.indexOf('status: "FAILED",'),
	);
	assert.match(
		text("apps/agent/agent/lib/run-runtime.ts"),
		/workspaceId:\s*WORKSPACE_ID,\s*runId,\s*OR/,
	);
});
test("strict Turbo development passes the actual application feature/config variable names", () => {
	const agent = parseJsonc(text("apps/agent/turbo.json"));
	for (const task of ["dev", "dev:headless"]) {
		const vars = agent.tasks[task].passThroughEnv;
		for (const name of [
			"AGENT_URL",
			"AGENT_APPROVAL_CENTER_ENABLED",
			"AGENT_APPROVAL_CONTINUATION_ENABLED",
			"AGENT_ACTION_POLICIES_JSON",
			"AGENT_ACTION_READ_ONLY",
		])
			assert.ok(vars.includes(name), `${task} must forward ${name}`);
	}
	const api = JSON.parse(text("apps/api/turbo.json"));
	for (const name of [
		"MIGRATION_CENTER_ENABLED",
		"MIGRATION_EXECUTION_ENABLED",
		"MIGRATION_SOURCE_ROOT",
		"MIGRATION_SOURCE_ACTIVE_KEY",
		"MIGRATION_SOURCE_KEYS_JSON",
		"AGENT_APPROVAL_CONTINUATION_ENABLED",
	])
		assert.ok(api.tasks.dev.passThroughEnv.includes(name), name);
});
