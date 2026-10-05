import { GovernedActionError } from "./index.mjs";

const DECISIONS = new Set(["ALLOW", "DENY", "REQUIRE_APPROVAL"]);
/** Deployment-owned deterministic policy; model input never defines a rule. */
export function createActionPolicy({
	rules = {},
	defaultDecision = "DENY",
	readOnly = false,
} = {}) {
	if (
		!DECISIONS.has(defaultDecision) ||
		typeof readOnly !== "boolean" ||
		!rules ||
		typeof rules !== "object" ||
		Array.isArray(rules) ||
		![null, Object.prototype].includes(Object.getPrototypeOf(rules))
	)
		throw new GovernedActionError(
			"INVALID_ACTION_POLICY",
			"Invalid deployment action policy",
		);
	const entries = Object.getOwnPropertyDescriptors(rules);
	if (Reflect.ownKeys(entries).length > 100)
		throw new GovernedActionError(
			"INVALID_ACTION_POLICY",
			"Too many action policy rules",
		);
	const catalog = new Map();
	for (const key of Reflect.ownKeys(entries)) {
		const property = entries[key];
		if (
			typeof key !== "string" ||
			!/^[a-z][a-z0-9_.-]{2,127}$/.test(key) ||
			!property.enumerable ||
			!("value" in property) ||
			!DECISIONS.has(property.value)
		)
			throw new GovernedActionError(
				"INVALID_ACTION_POLICY",
				"Invalid action policy rule",
			);
		catalog.set(key, property.value);
	}
	return Object.freeze(({ manifest }) => {
		if (
			!manifest ||
			!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(manifest.risk) ||
			typeof manifest.mutating !== "boolean"
		)
			return Object.freeze({
				allowed: false,
				requiresApproval: false,
				reason: "Invalid action manifest",
			});
		const decision =
			readOnly && manifest.mutating
				? "DENY"
				: (catalog.get(manifest.id) ?? defaultDecision);
		if (decision === "DENY")
			return Object.freeze({
				allowed: false,
				requiresApproval: false,
				reason: "Deployment policy denies this action",
			});
		return Object.freeze({
			allowed: true,
			requiresApproval:
				decision === "REQUIRE_APPROVAL" ||
				["HIGH", "CRITICAL"].includes(manifest.risk),
			reason: "Deployment policy evaluated against the current action manifest",
		});
	});
}
