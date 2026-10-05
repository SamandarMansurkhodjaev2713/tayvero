import { fail } from "./errors.mjs";

const BATCH_STATUS = new Set(["PENDING", "RUNNING", "COMPLETED", "FAILED"]);
const TRANSITIONS = Object.freeze({
  PENDING: new Set(["RUNNING", "FAILED"]),
  RUNNING: new Set(["RUNNING", "PENDING", "COMPLETED", "FAILED"]),
  COMPLETED: new Set(),
  FAILED: new Set(),
});

function integer(value, path, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) fail("INVALID_BATCH_UPDATE", `${path} is invalid`);
  return value;
}

function isoOrNull(value, path) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) fail("INVALID_BATCH_UPDATE", `${path} is invalid`);
  return date.toISOString();
}

export function nextBatchState(current, proposed) {
  if (!current || typeof current !== "object" || !proposed || typeof proposed !== "object" || Array.isArray(proposed)) {
    fail("INVALID_BATCH_UPDATE", "Migration batch updater must return an object");
  }
  for (const field of ["index", "digest", "count", "rowStart", "rowEnd"]) {
    if (proposed[field] !== current[field]) fail("IMMUTABLE_BATCH_FIELD", `Migration batch field is immutable: ${field}`, { field });
  }
  if (!BATCH_STATUS.has(proposed.status)) fail("INVALID_BATCH_UPDATE", "Migration batch status is invalid", { status: proposed.status });
  if (!TRANSITIONS[current.status]?.has(proposed.status)) {
    fail("INVALID_BATCH_TRANSITION", "Migration batch transition is invalid", { from: current.status, to: proposed.status });
  }

  const attempts = integer(proposed.attempts, "batch.attempts");
  if (attempts < current.attempts) fail("INVALID_BATCH_UPDATE", "Migration attempt counter cannot move backwards");
  const importedCount = integer(proposed.importedCount, "batch.importedCount");
  const rejectedCount = integer(proposed.rejectedCount, "batch.rejectedCount");
  if (importedCount + rejectedCount > current.count) fail("INVALID_BATCH_UPDATE", "Migration batch counters exceed the planned row count");
  if (proposed.status === "COMPLETED" && importedCount + rejectedCount !== current.count) {
    fail("INVALID_BATCH_UPDATE", "Completed migration batch must account for every planned row");
  }

  const leaseOwner = proposed.leaseOwner ?? null;
  const leaseExpiresAt = isoOrNull(proposed.leaseExpiresAt, "batch.leaseExpiresAt");
  const completedAt = isoOrNull(proposed.completedAt, "batch.completedAt");
  if (proposed.status === "RUNNING") {
    if (typeof leaseOwner !== "string" || leaseOwner.length < 3 || !leaseExpiresAt) {
      fail("INVALID_BATCH_UPDATE", "Running migration batch requires a valid lease owner and expiry");
    }
    if (completedAt) fail("INVALID_BATCH_UPDATE", "Running migration batch cannot have completedAt");
  } else {
    if (leaseOwner !== null || leaseExpiresAt !== null) fail("INVALID_BATCH_UPDATE", "Non-running migration batch cannot keep a worker lease");
    if (proposed.status === "COMPLETED" && !completedAt) fail("INVALID_BATCH_UPDATE", "Completed migration batch requires completedAt");
    if (proposed.status !== "COMPLETED" && completedAt) fail("INVALID_BATCH_UPDATE", "Non-completed migration batch cannot have completedAt");
  }

  return Object.freeze({
    ...proposed,
    attempts,
    importedCount,
    rejectedCount,
    leaseOwner,
    leaseExpiresAt,
    completedAt,
    version: integer(current.version, "batch.version", 1) + 1,
  });
}
