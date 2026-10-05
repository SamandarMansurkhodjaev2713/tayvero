import assert from "node:assert/strict";
import test from "node:test";
import {
	canonicalJson,
	createGovernedActionExecutor,
	createMemoryReceiptStore,
} from "../src/index.mjs";

const context = {
	tenantId: "w",
	actorId: "u",
	requestId: "r",
	permissions: ["test.execute"],
};
function harness() {
	let executions = 0;
	const entry = {
		manifest: {
			id: "test.execute",
			version: "1",
			risk: "LOW",
			mutating: false,
			idempotency: "INHERENT",
			permissions: ["test.execute"],
			timeoutMs: 100,
			inputValidator: (value) => value,
			outputValidator: (value) => value,
		},
		execute: async () => {
			executions++;
			return { ok: true };
		},
	};
	const executor = createGovernedActionExecutor({
		registry: new Map([["test.execute", entry]]),
		authorizer: async () => true,
		policyEvaluator: async () => ({ allowed: true, requiresApproval: false }),
		receiptStore: createMemoryReceiptStore(),
		auditSink: { append: async () => {} },
	});
	return {
		executor,
		get executions() {
			return executions;
		},
	};
}
function assertCode(fn, code) {
	assert.throws(fn, (error) => error?.code === code);
}
test("canonical hashing rejects accessor properties without invoking them", () => {
	let calls = 0;
	const value = {};
	Object.defineProperty(value, "amount", {
		enumerable: true,
		get() {
			calls++;
			return 100;
		},
	});
	assertCode(() => canonicalJson(value), "UNSAFE_PAYLOAD_ACCESSOR");
	assert.equal(calls, 0);
});
test("rejects sparse arrays so absent elements cannot alias explicit null", () =>
	assertCode(() => canonicalJson(new Array(2)), "NON_JSON_VALUE"));
test("rejects over-depth inputs with a bounded domain error rather than stack overflow", () => {
	let value = {};
	for (let i = 0; i < 1000; i++) value = { child: value };
	assertCode(() => canonicalJson(value), "ACTION_DATA_LIMIT");
});
test("rejects oversized strings and excessive node counts", () => {
	assertCode(
		() => canonicalJson({ text: "a".repeat(1000001) }),
		"ACTION_DATA_LIMIT",
	);
	assertCode(
		() => canonicalJson(Array.from({ length: 20001 }, () => 0)),
		"ACTION_DATA_LIMIT",
	);
});
test("input snapshot rejects a getter before execution", async () => {
	const h = harness();
	let calls = 0;
	const input = {};
	Object.defineProperty(input, "field", {
		enumerable: true,
		get() {
			calls++;
			return "bad";
		},
	});
	await assert.rejects(
		h.executor.execute({
			actionId: "test.execute",
			context,
			input,
			idempotencyKey: "k",
		}),
		(e) => e?.code === "UNSAFE_PAYLOAD_ACCESSOR",
	);
	assert.equal(calls, 0);
	assert.equal(h.executions, 0);
});
test("normal JSON digests remain stable and object undefined fields stay omitted", () => {
	assert.equal(
		canonicalJson({ b: 2, a: [null, true, "x"], optional: undefined }),
		'{"a":[null,true,"x"],"b":2}',
	);
});
