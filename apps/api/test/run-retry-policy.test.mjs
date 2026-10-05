import assert from "node:assert/strict";
import test from "node:test";
import { runRetryPolicy } from "../src/agent/run-retry-policy.mjs";

const run = (extra = {}) => ({ status: "FAILED", actions: [], ...extra });
test("allows failed/cancelled runs only when no attempted side effects are recorded", () => {
	assert.equal(runRetryPolicy(run()).allowed, true);
	assert.equal(
		runRetryPolicy(
			run({
				status: "CANCELLED",
				actions: [{ status: "PLANNED", attemptCount: 0 }],
			}),
		).allowed,
		true,
	);
});
test("blocks a succeeded action even when the run failed afterwards", () =>
	assert.equal(
		runRetryPolicy(
			run({
				actions: [
					{ status: "SUCCEEDED", attemptCount: 1, externalId: "message-1" },
				],
			}),
		).allowed,
		false,
	));
test("blocks uncertain remote outcomes and attempts that are marked failed", () => {
	for (const action of [
		{ status: "FAILED", attemptCount: 1 },
		{ status: "CANCELLED", attemptCount: 0, externalId: "message-1" },
		{ status: "RUNNING", attemptCount: 0 },
	])
		assert.equal(
			runRetryPolicy(run({ actions: [action] })).code,
			"RUN_REQUIRES_RECONCILIATION",
		);
});
test("missing/truncated history never becomes proof of no side effects", () => {
	assert.equal(
		runRetryPolicy(run({ actions: undefined })).code,
		"RETRY_HISTORY_INCOMPLETE",
	);
	assert.equal(runRetryPolicy(run({ actionsTruncated: true })).allowed, false);
});
test("ambiguous receipt errors stay blocked even without an action mirror", () => {
	for (const errorCode of [
		"ACTION_OUTCOME_AMBIGUOUS",
		"AUDIT_WRITE_FAILED_AFTER_COMMIT",
		"ACTION_REQUIRES_RECONCILIATION",
	])
		assert.equal(runRetryPolicy(run({ errorCode })).allowed, false);
});
test("successful, active and unknown run states are not retried under a failure label", () => {
	for (const status of [
		"SUCCEEDED",
		"RUNNING",
		"WAITING_FOR_APPROVAL",
		"QUEUED",
		"UNKNOWN",
	])
		assert.equal(runRetryPolicy(run({ status })).allowed, false);
});
test("unknown attempt counters or action states fail closed", () => {
	for (const action of [
		{ status: "FAILED" },
		{ status: "UNKNOWN", attemptCount: 0 },
		{ status: "FAILED", attemptCount: -1 },
	])
		assert.equal(runRetryPolicy(run({ actions: [action] })).allowed, false);
});
