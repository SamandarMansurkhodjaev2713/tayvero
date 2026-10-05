import assert from "node:assert/strict";
import test from "node:test";
import { runBackgroundLoop } from "../background-loop.mjs";

test("worker once processes one tick and returns without claiming an asynchronous promise", async () => {
	let calls = 0;
	const result = await runBackgroundLoop({
		runOnce: async () => {
			calls++;
			return { examined: 0 };
		},
		signal: new AbortController().signal,
		once: true,
	});
	assert.equal(calls, 1);
	assert.equal(result.ticks, 1);
});
test("worker shutdown drains the current tick and does not start a replacement tick", async () => {
	const c = new AbortController();
	const seen = [];
	const result = await runBackgroundLoop({
		signal: c.signal,
		runOnce: async () => {
			seen.push("started");
			c.abort();
			await Promise.resolve();
			seen.push("settled");
			return {};
		},
		onTick: () => seen.push("reported"),
	});
	assert.deepEqual(seen, ["started", "settled", "reported"]);
	assert.equal(result.stopped, true);
});
test("worker exits for review on once failure and emits no raw credentials", async () => {
	const logs = [];
	await assert.rejects(
		runBackgroundLoop({
			signal: new AbortController().signal,
			once: true,
			runOnce: async () => {
				throw new Error("postgres://secret");
			},
			onError: (r) => logs.push(r),
		}),
		/WORKER_STOPPED_FOR_REVIEW/,
	);
	assert.equal(JSON.stringify(logs).includes("secret"), false);
});
test("worker validates poll bounds and honors already-aborted signal", async () => {
	const c = new AbortController();
	c.abort();
	let called = false;
	await runBackgroundLoop({
		signal: c.signal,
		runOnce: async () => {
			called = true;
		},
	});
	assert.equal(called, false);
	await assert.rejects(
		runBackgroundLoop({ signal: c.signal, pollMs: 1, runOnce: async () => {} }),
		/Invalid/,
	);
});
