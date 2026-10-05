import assert from "node:assert/strict";
import test from "node:test";
import {
	displayRunCost,
	filterTeamAgents,
	summarizeTeamAgents,
} from "../components/agent-builder/team-agents-model.mjs";

const rows = [
	{
		id: "1",
		name: "Follow-up",
		description: "Sales assistant",
		status: "LIVE",
		lastRun: { status: "FAILED", costUsd: "0.001" },
	},
	{
		id: "2",
		name: "Reports",
		status: "PAUSED",
		lastRun: { status: "WAITING_FOR_APPROVAL" },
	},
	{
		id: "3",
		name: "Old agent",
		status: "ARCHIVED",
		lastRun: { status: "FAILED" },
	},
	{ id: "4", name: "New agent", status: "LIVE" },
];
test("summaries use visible facts, exclude archived review and disclose old-server coverage", () => {
	assert.deepEqual(summarizeTeamAgents(rows), {
		visible: 4,
		live: 2,
		paused: 1,
		needsReview: 2,
		latestRunCoverage: 3,
	});
});
test("current filter excludes archived without hiding it from the all view", () => {
	assert.equal(filterTeamAgents(rows).length, 3);
	assert.equal(filterTeamAgents(rows, { view: "all" }).length, 4);
});
test("review is explicitly the latest run, not a global approval count", () =>
	assert.deepEqual(
		filterTeamAgents(rows, { view: "review" }).map((x) => x.id),
		["1", "2"],
	));
test("search is trimmed case insensitive and matches description", () =>
	assert.deepEqual(
		filterTeamAgents(rows, { query: " SALES " }).map((x) => x.id),
		["1"],
	));
test("zero cost is real recorded cost; unknown does not become zero", () => {
	assert.equal(displayRunCost("0"), "$0.00");
	assert.equal(displayRunCost(null), "Not recorded");
	assert.equal(displayRunCost("0.000001"), "$0.000001");
	assert.equal(displayRunCost("NaN"), "Not recorded");
});
test("empty data never produces invented runs, savings or success rates", () => {
	const summary = summarizeTeamAgents([]);
	assert.equal(summary.needsReview, 0);
	assert.equal("roi" in summary, false);
	assert.equal("successRate" in summary, false);
});
