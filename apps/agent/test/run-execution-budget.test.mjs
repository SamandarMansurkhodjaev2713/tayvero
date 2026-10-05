import assert from "node:assert/strict";
import test from "node:test";
import { executionBudgetExpired } from "../src/run-execution-budget.mjs";

const start = new Date("2026-09-15T10:00:00Z");
const running = {
	status: "RUNNING",
	sessionId: "root",
	startedAt: start,
	cancelRequestedAt: null,
};
const options = {
	now: new Date(start.getTime() + 21000),
	timeoutMs: 20000,
	continuationEnabled: true,
};
test("timeout selection cannot fail a run that parked after the query snapshot", () => {
	assert.equal(executionBudgetExpired(running, options), true);
	assert.equal(
		executionBudgetExpired(
			{ ...running, status: "WAITING_FOR_APPROVAL" },
			options,
		),
		false,
	);
});
test("resume uses extended execution budget without changing historical startedAt", () => {
	assert.equal(
		executionBudgetExpired(
			{
				...running,
				approvalExecutionDeadlineAt: new Date(start.getTime() + 30000),
			},
			options,
		),
		false,
	);
	assert.equal(
		executionBudgetExpired(
			{
				...running,
				approvalExecutionDeadlineAt: new Date(start.getTime() + 20000),
			},
			options,
		),
		true,
	);
	assert.equal(
		executionBudgetExpired(
			{
				...running,
				approvalExecutionDeadlineAt: new Date(start.getTime() + 30000),
			},
			{ ...options, continuationEnabled: false },
		),
		true,
	);
});
test("cancelled, detached and terminal runs are never timed out by a stale scan", () => {
	for (const status of ["SUCCEEDED", "FAILED", "CANCELLED", "QUEUED"])
		assert.equal(
			executionBudgetExpired({ ...running, status }, options),
			false,
		);
	assert.equal(
		executionBudgetExpired({ ...running, cancelRequestedAt: start }, options),
		false,
	);
	assert.equal(
		executionBudgetExpired({ ...running, sessionId: null }, options),
		false,
	);
	assert.equal(
		executionBudgetExpired({ ...running, startedAt: null }, options),
		false,
	);
});
test("execution budget rejects corrupt configuration and saved deadlines", () => {
	assert.throws(
		() => executionBudgetExpired(running, { ...options, timeoutMs: -1 }),
		TypeError,
	);
	assert.throws(
		() =>
			executionBudgetExpired(
				{ ...running, approvalExecutionDeadlineAt: "bad" },
				options,
			),
		TypeError,
	);
});
