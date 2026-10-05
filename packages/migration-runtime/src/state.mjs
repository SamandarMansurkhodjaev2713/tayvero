
import { fail } from "./errors.mjs";
export const JOB_STATUS = Object.freeze({ CREATED: "CREATED", VALIDATING: "VALIDATING", READY: "READY", IMPORTING: "IMPORTING", COMPLETED: "COMPLETED", FAILED: "FAILED", CANCELLED: "CANCELLED" });
const ALLOWED = Object.freeze({ CREATED: new Set(["VALIDATING", "CANCELLED"]), VALIDATING: new Set(["READY", "FAILED", "CANCELLED"]), READY: new Set(["IMPORTING", "CANCELLED"]), IMPORTING: new Set(["COMPLETED", "FAILED", "CANCELLED"]), COMPLETED: new Set(), FAILED: new Set(), CANCELLED: new Set() });
export function transitionStatus(current, next) {
  if (!ALLOWED[current] || !ALLOWED[current].has(next)) fail("INVALID_JOB_TRANSITION", "Migration job status transition is not allowed", { current, next });
  return next;
}
