import { createApprovalPayloadHash } from "./idempotency.mjs";

export const Risk = Object.freeze({
  READ: "READ",
  DRAFT: "DRAFT",
  INTERNAL_WRITE: "INTERNAL_WRITE",
  EXTERNAL_COMMUNICATION: "EXTERNAL_COMMUNICATION",
  BUSINESS_STATE_CHANGE: "BUSINESS_STATE_CHANGE",
  IRREVERSIBLE: "IRREVERSIBLE",
});
const APPROVAL_BY_DEFAULT = new Set([Risk.EXTERNAL_COMMUNICATION, Risk.BUSINESS_STATE_CHANGE, Risk.IRREVERSIBLE]);

function matches(pattern, action) {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return action.startsWith(pattern.slice(0, -1));
  return pattern === action;
}
function anyMatch(patterns, action) { return Array.isArray(patterns) && patterns.some((pattern) => matches(pattern, action)); }
function deny(code, message) { return { decision: "DENY", code, message }; }
function approval(code, message, payloadHash) { return { decision: "REQUIRE_APPROVAL", code, message, payloadHash }; }

export function evaluateAgentAction(policy, request, now = new Date()) {
  if (!policy || !request) throw new TypeError("policy and request are required");
  const { action, tenantId, resourceId, payload, risk, environment, estimatedCostMinor = "0" } = request;
  if (typeof action !== "string" || action.trim() === "") return deny("INVALID_ACTION", "Action is missing");
  if (!Object.values(Risk).includes(risk)) return deny("INVALID_RISK", "Action risk is not recognized");
  if (anyMatch(policy.deniedActions, action)) return deny("EXPLICIT_DENY", "Action is explicitly denied");
  if (!anyMatch(policy.allowedActions, action)) return deny("NOT_ALLOWED", "Action is not in the allowlist");
  if (Array.isArray(policy.allowedEnvironments) && !policy.allowedEnvironments.includes(environment)) return deny("ENVIRONMENT_DENIED", "Environment is outside policy");
  const cost = BigInt(estimatedCostMinor);
  if (cost < 0n) return deny("INVALID_COST", "Estimated cost cannot be negative");
  if (policy.maxActionCostMinor !== undefined && cost > BigInt(policy.maxActionCostMinor)) return deny("ACTION_BUDGET_EXCEEDED", "Estimated action cost exceeds policy");
  const payloadHash = createApprovalPayloadHash({ tenantId, action, resourceId, payload });
  const requiresApproval = risk === Risk.IRREVERSIBLE || APPROVAL_BY_DEFAULT.has(risk) || anyMatch(policy.approvalRequiredActions, action);
  if (!requiresApproval) return { decision: "ALLOW", code: "POLICY_ALLOWED", payloadHash };
  const provided = request.approval;
  if (!provided) return approval("APPROVAL_REQUIRED", "Action requires approval", payloadHash);
  if (provided.payloadHash !== payloadHash) return deny("APPROVAL_PAYLOAD_MISMATCH", "Approval does not match the immutable action payload");
  if (provided.approverAuthorized !== true) return deny("APPROVER_UNAUTHORIZED", "Approver lacks permission for this resource/action");
  const expiresAt = new Date(provided.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) return deny("APPROVAL_EXPIRED", "Approval is expired or invalid");
  if (provided.consumedAt) return deny("APPROVAL_REPLAY", "Approval has already been consumed");
  return { decision: "ALLOW", code: "APPROVED", payloadHash, approvalId: provided.id };
}
