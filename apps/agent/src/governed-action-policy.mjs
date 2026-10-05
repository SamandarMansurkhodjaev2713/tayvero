import {
	createActionPolicy,
	GovernedActionError,
} from "@crm/agent-action-runtime";
export function deploymentActionPolicy(environment = process.env) {
	const encoded = environment.AGENT_ACTION_POLICIES_JSON?.trim() || "{}";
	if (encoded.length > 16384)
		throw new GovernedActionError(
			"INVALID_ACTION_POLICY",
			"Deployment action policy is too large",
		);
	let rules;
	try {
		rules = JSON.parse(encoded);
	} catch {
		throw new GovernedActionError(
			"INVALID_ACTION_POLICY",
			"Deployment action policy is not valid JSON",
		);
	}
	// Existing immutable deployed manifests remain the bounded allow-list. These overrides
	// can restrict them, but cannot add capabilities or bypass the runtime authorizer.
	return createActionPolicy({
		rules,
		defaultDecision: "ALLOW",
		readOnly: environment.AGENT_ACTION_READ_ONLY === "1",
	});
}
