import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryReceiptStore } from "../src/index.mjs";

test("memory reference adapter quarantines expired unsafe execution too", async () => {
	const store = createMemoryReceiptStore({ leaseMs: 1000 });
	const now = new Date("2026-09-13T00:00:00Z");
	await store.begin({ key: "action", digest: "a", now });
	await assert.rejects(
		store.begin({
			key: "action",
			digest: "a",
			now: new Date(now.getTime() + 1001),
		}),
		(e) => e.code === "ACTION_REQUIRES_RECONCILIATION",
	);
});
