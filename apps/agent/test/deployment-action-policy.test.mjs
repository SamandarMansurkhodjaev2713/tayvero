import assert from "node:assert/strict";
import test from "node:test";
import { deploymentActionPolicy } from "../src/governed-action-policy.mjs";

const request = {
	manifest: { id: "crm.activity.create", risk: "LOW", mutating: true },
};
test("unset and example-env blank rules preserve the bounded deployed manifest policy", () => {
	assert.equal(deploymentActionPolicy({})(request).allowed, true);
	assert.equal(
		deploymentActionPolicy({ AGENT_ACTION_POLICIES_JSON: "" })(request).allowed,
		true,
	);
	assert.equal(
		deploymentActionPolicy({ AGENT_ACTION_POLICIES_JSON: "  " })(request)
			.allowed,
		true,
	);
});
test("malformed configuration fails closed, never silently ignores intended restrictions", () => {
	for (const value of [
		"{broken}",
		"null",
		"[]",
		'{"*":"ALLOW"}',
		'{"crm.activity.create":"allow"}',
	])
		assert.throws(() =>
			deploymentActionPolicy({ AGENT_ACTION_POLICIES_JSON: value }),
		);
});
test("deployment rules and read-only mode cannot be changed with request fields", () => {
	const policy = deploymentActionPolicy({
		AGENT_ACTION_POLICIES_JSON: '{"crm.activity.create":"REQUIRE_APPROVAL"}',
	});
	assert.equal(
		policy({ ...request, rules: { "crm.activity.create": "ALLOW" } })
			.requiresApproval,
		true,
	);
	assert.equal(
		deploymentActionPolicy({ AGENT_ACTION_READ_ONLY: "1" })(request).allowed,
		false,
	);
});
