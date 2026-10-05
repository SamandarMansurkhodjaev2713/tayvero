import assert from "node:assert/strict";
import test from "node:test";
import { createPipelineCommandKeyStore } from "../app/(app)/[slug]/settings/pipelines/pipeline-command-keys.mjs";

function factory() {
	let count = 0;
	return (scope) => `${scope}:key-${String(++count).padStart(8, "0")}`;
}

test("reuses the same key for a retry of an unchanged command", () => {
	const store = createPipelineCommandKeyStore({ keyFactory: factory() });
	const first = store.get("pipeline-update:p1", '{"version":1}');
	const retry = store.get("pipeline-update:p1", '{"version":1}');
	assert.equal(retry, first);
	assert.equal(store.size(), 1);
});

test("rotates the key when the command payload changes", () => {
	const store = createPipelineCommandKeyStore({ keyFactory: factory() });
	const first = store.get("pipeline-update:p1", '{"version":1}');
	const changed = store.get("pipeline-update:p1", '{"version":2}');
	assert.notEqual(changed, first);
	assert.equal(store.size(), 1);
});

test("clears only the key that completed", () => {
	const store = createPipelineCommandKeyStore({ keyFactory: factory() });
	const key = store.get("pipeline-archive:p1", "1");
	assert.equal(store.clear("pipeline-archive:p1", "another-key"), false);
	assert.equal(store.get("pipeline-archive:p1", "1"), key);
	assert.equal(store.clear("pipeline-archive:p1", key), true);
	assert.notEqual(store.get("pipeline-archive:p1", "1"), key);
});

test("bounds retained failed-command keys", () => {
	const store = createPipelineCommandKeyStore({
		capacity: 2,
		keyFactory: factory(),
	});
	store.get("pipeline-create:a", "a");
	store.get("pipeline-create:b", "b");
	store.get("pipeline-create:c", "c");
	assert.equal(store.size(), 2);
});

test("rejects malformed scopes, fingerprints and generated keys", () => {
	const store = createPipelineCommandKeyStore({ keyFactory: factory() });
	assert.throws(() => store.get("invalid scope", "x"), /unsupported/);
	assert.throws(() => store.get("pipeline-create", ""), /fingerprint/);
	assert.throws(
		() =>
			createPipelineCommandKeyStore({ keyFactory: () => "bad key" }).get(
				"pipeline-create",
				"x",
			),
		/invalid idempotency key/,
	);
});
