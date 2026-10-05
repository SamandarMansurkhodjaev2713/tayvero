import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("PostgreSQL gate refuses implicit or production database targets", async () => {
	const source = await read("tools/release/run-pipeline-postgres-gate.mjs");
	assert.match(source, /TEST_DATABASE_URL is required explicitly/);
	assert.match(source, /endsWith\("_test"\)/);
	assert.match(source, /testUrl === liveUrl/);
	assert.doesNotMatch(source, /TEST_DATABASE_URL \?\? process\.env\.DATABASE_URL/);
});

test("PostgreSQL integration spec exercises row locking, rollback and simultaneous writers", async () => {
	const source = await read("apps/api/test/deal-pipeline-dual-write.integration.spec.ts");
	assert.match(source, /FOR UPDATE/);
	assert.match(source, /legacy write was rolled back/);
	assert.match(source, /Promise\.all\(\[/);
	assert.match(source, /assignment\.stageId\)\.toBe\(expectedStageId\)/);
});
