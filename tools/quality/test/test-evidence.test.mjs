import assert from "node:assert/strict";
import test from "node:test";
import {
	hasCompleteTestEvidence,
	parseTestSummary,
} from "../lib/test-evidence.mjs";

const summary = (overrides = {}) => ({
	tests: 2,
	pass: 2,
	fail: 0,
	skipped: 0,
	cancelled: 0,
	todo: 0,
	...overrides,
});

test("release test evidence accepts a complete TAP summary on LF and Windows CRLF", () => {
	for (const newline of ["\n", "\r\n"]) {
		const output = Object.entries(summary())
			.map(([key, value]) => `# ${key} ${value}`)
			.join(newline);
		assert.deepEqual(parseTestSummary(output), summary());
		assert.equal(hasCompleteTestEvidence(parseTestSummary(output)), true);
	}
});

test("release test evidence cannot turn missing, skipped, cancelled or failed coverage green", () => {
	for (const value of [
		parseTestSummary(""),
		summary({ tests: 0, pass: 0 }),
		summary({ pass: 1, skipped: 1 }),
		summary({ pass: 1, fail: 1 }),
		summary({ cancelled: 1 }),
		summary({ todo: 1 }),
		summary({ pass: null }),
		summary({ tests: Number.NaN }),
	]) {
		assert.equal(hasCompleteTestEvidence(value), false);
	}
});

test("release test evidence uses the final TAP summary rather than an earlier passing run", () => {
	const output = [summary(), summary({ pass: 1, fail: 1 })]
		.flatMap((value) =>
			Object.entries(value).map(([key, number]) => `# ${key} ${number}`),
		)
		.join("\n");
	assert.deepEqual(parseTestSummary(output), summary({ pass: 1, fail: 1 }));
	assert.equal(hasCompleteTestEvidence(parseTestSummary(output)), false);
});
