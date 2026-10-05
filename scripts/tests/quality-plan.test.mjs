import assert from "node:assert/strict";
import test from "node:test";
import { qualityPlan } from "../lib/quality-plan.mjs";

const manifest = {
	scripts: {
		"format:check": "biome format .",
		lint: "lint",
		"check-types": "tsc",
		test: "test",
		build: "build",
	},
};
test("semantic check-types is mandatory, not an absent typecheck alias", () => {
	assert.deepEqual(qualityPlan(manifest), [
		"format:check",
		"lint",
		"check-types",
		"test",
		"build",
	]);
	assert.throws(
		() =>
			qualityPlan({
				scripts: { ...manifest.scripts, "check-types": undefined },
			}),
		/check-types/,
	);
});
test("a full quality gate cannot silently skip build", () => {
	assert.throws(
		() => qualityPlan(manifest, { QUALITY_SKIP_BUILD: "1" }),
		/cannot skip/,
	);
});
