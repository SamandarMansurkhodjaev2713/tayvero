
import { fail } from "./errors.mjs";

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/;
export function createRuntimeContext(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail("INVALID_CONTEXT", "Runtime context must be an object");
  for (const field of ["tenantId", "actorId", "requestId"]) {
    if (typeof input[field] !== "string" || !ID.test(input[field])) fail("INVALID_CONTEXT_FIELD", `${field} is invalid`, { field });
  }
  if (!Array.isArray(input.permissions) || input.permissions.some((permission) => typeof permission !== "string" || permission.length === 0)) {
    fail("INVALID_PERMISSIONS", "permissions must be a string array");
  }
  return Object.freeze({ tenantId: input.tenantId, actorId: input.actorId, requestId: input.requestId, permissions: Object.freeze([...new Set(input.permissions)]) });
}
export function requirePermission(context, permission) {
  if (!context.permissions.includes(permission) && !context.permissions.includes("*")) fail("PERMISSION_DENIED", "The actor is not allowed to perform this action", { permission });
}
