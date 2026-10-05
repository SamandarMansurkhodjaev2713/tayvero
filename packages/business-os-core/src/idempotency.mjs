import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.mjs";

function requiredText(value, field) {
	if (typeof value !== "string" || value.trim() === "")
		throw new TypeError(`${field} must be a non-empty string`);
	return value.trim();
}

export function createIdempotencyKey({
	tenantId,
	action,
	payload,
	version = "v1",
}) {
	const normalizedVersion = requiredText(version, "version");
	const normalizedTenantId = requiredText(tenantId, "tenantId");
	const normalizedAction = requiredText(action, "action");
	const digest = createHash("sha256")
		.update(
			canonicalJson({
				tenantId: normalizedTenantId,
				action: normalizedAction,
				payload,
			}),
		)
		.digest("base64url");
	return `${normalizedVersion}:${normalizedAction}:${digest}`;
}

export function createApprovalPayloadHash({
	tenantId,
	action,
	resourceId,
	payload,
}) {
	return createHash("sha256")
		.update(
			canonicalJson({
				tenantId: requiredText(tenantId, "tenantId"),
				action: requiredText(action, "action"),
				resourceId: requiredText(resourceId, "resourceId"),
				payload,
			}),
		)
		.digest("base64url");
}
