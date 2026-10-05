import assert from "node:assert/strict";
import { constants } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createEncryptedFileSourceStore } from "../src/source-store.mjs";

test("source storage refuses unsupported filesystem capabilities before publishing directories", async (t) => {
	const parent = await mkdtemp(path.join(tmpdir(), "tayvero-source-guard-"));
	t.after(() => rm(parent, { recursive: true, force: true }));
	const root = constants.O_NOFOLLOW
		? "relative-source-root"
		: path.join(parent, "sources");
	await assert.rejects(
		createEncryptedFileSourceStore({
			root,
			keys: { v1: new Uint8Array(32).fill(7) },
			activeKeyId: "v1",
		}),
		{ code: "SOURCE_STORE_CONFIG" },
	);
	assert.deepEqual(await readdir(parent), []);
});
