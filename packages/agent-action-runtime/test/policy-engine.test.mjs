import assert from "node:assert/strict";
import test from "node:test";
import { createActionPolicy } from "../src/index.mjs";

const manifest = { id: "crm.deal.update", risk: "LOW", mutating: true };
test("unknown actions default to denial", () =>
	assert.equal(createActionPolicy()({ manifest }).allowed, false));
test("exact ALLOW rule permits only already-authorized low-risk action", () =>
	assert.deepEqual(
		createActionPolicy({ rules: { "crm.deal.update": "ALLOW" } })({ manifest })
			.requiresApproval,
		false,
	));
test("high and critical risks cannot be downgraded by an ALLOW rule", () => {
	for (const risk of ["HIGH", "CRITICAL"])
		assert.equal(
			createActionPolicy({ rules: { "crm.deal.update": "ALLOW" } })({
				manifest: { ...manifest, risk },
			}).requiresApproval,
			true,
		);
});
test("read-only overrides allow and approval for mutating actions", () =>
	assert.equal(
		createActionPolicy({
			rules: { "crm.deal.update": "ALLOW" },
			readOnly: true,
		})({ manifest }).allowed,
		false,
	));
test("explicit REQUIRE_APPROVAL is honored for low-risk actions", () =>
	assert.equal(
		createActionPolicy({ rules: { "crm.deal.update": "REQUIRE_APPROVAL" } })({
			manifest,
		}).requiresApproval,
		true,
	));
test("malformed rules, wildcards and getters are rejected without execution", () => {
	let called = false;
	for (const rules of [
		{ "*": "ALLOW" },
		{ "crm.deal.update": "YES" },
		Object.defineProperty({}, "crm.deal.update", {
			enumerable: true,
			get() {
				called = true;
				return "ALLOW";
			},
		}),
	])
		assert.throws(() => createActionPolicy({ rules }));
	assert.equal(called, false);
});
test("malformed risk never becomes an implicitly allowed action", () =>
	assert.equal(
		createActionPolicy({ defaultDecision: "ALLOW" })({
			manifest: { ...manifest, risk: "" },
		}).allowed,
		false,
	));
test("model-supplied policy fields have no authority", () =>
	assert.equal(
		createActionPolicy()({
			manifest,
			input: { decision: "ALLOW" },
			requiresApproval: false,
		}).allowed,
		false,
	));
