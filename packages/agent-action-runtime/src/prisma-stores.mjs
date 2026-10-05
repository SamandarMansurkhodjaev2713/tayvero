import { createHash, randomBytes } from "node:crypto";
import { GovernedActionError, redactForAudit } from "./index.mjs";

const RECEIPT_STATUS = Object.freeze({ IN_PROGRESS: "IN_PROGRESS", SUCCEEDED: "SUCCEEDED", FAILED: "FAILED" });

function delegate(prisma, name) {
  const value = prisma?.[name];
  if (!value) throw new GovernedActionError("PRISMA_DELEGATE_MISSING", `Prisma delegate ${name} is not available`);
  return value;
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function token() { return randomBytes(32).toString("base64url"); }
function isUniqueViolation(error) { return error?.code === "P2002" || error?.code === "23505"; }
function assertDate(value, field) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new GovernedActionError("INVALID_STORE_INPUT", `${field} must be a valid Date`);
  return value;
}
function assertString(value, field) {
  if (typeof value !== "string" || value.length === 0) throw new GovernedActionError("INVALID_STORE_INPUT", `${field} is required`);
  return value;
}
async function transaction(prisma, callback) {
  if (typeof prisma?.$transaction !== "function") throw new GovernedActionError("PRISMA_TRANSACTION_REQUIRED", "A transactional Prisma client is required");
  return prisma.$transaction(callback);
}

export function createPrismaReceiptStore({ prisma, model = "governedActionReceipt", leaseMs = 30_000, maxAcquireAttempts = 3 } = {}) {
  if (!prisma) throw new GovernedActionError("INVALID_STORE_CONFIG", "prisma is required");
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 900_000) throw new GovernedActionError("INVALID_STORE_CONFIG", "leaseMs must be 1000..900000");
  if (!Number.isInteger(maxAcquireAttempts) || maxAcquireAttempts < 1 || maxAcquireAttempts > 10) throw new GovernedActionError("INVALID_STORE_CONFIG", "maxAcquireAttempts must be 1..10");

  async function acquire({ key, digest, tenantId, actionId, now, replaySafe = false, minimumLeaseMs = 0 }, attempt = 1) {
    assertString(key, "key"); assertString(digest, "digest"); assertString(tenantId, "tenantId"); assertString(actionId, "actionId"); assertDate(now, "now");
    if (typeof replaySafe !== "boolean" || !Number.isSafeInteger(minimumLeaseMs) || minimumLeaseMs < 0 || minimumLeaseMs > 900000) throw new GovernedActionError("INVALID_STORE_INPUT", "Receipt replay capability or minimum lease is invalid");
    const lease = token(); const leaseTokenHash = sha256(lease); const leaseExpiresAt = new Date(now.getTime() + Math.max(leaseMs, minimumLeaseMs));
    try {
      const acquired = await transaction(prisma, async (tx) => {
        const table = delegate(tx, model);
        const existing = await table.findUnique({ where: { workspaceId_actionId_idempotencyKey: { workspaceId: tenantId, actionId, idempotencyKey: key } } });
        if (existing?.payloadDigest && existing.payloadDigest !== digest) throw new GovernedActionError("IDEMPOTENCY_KEY_REUSED", "Idempotency key was reused with a different payload");
        if (existing?.status === RECEIPT_STATUS.SUCCEEDED) return { status: "SUCCEEDED", digest: existing.payloadDigest, result: existing.resultJson };
        if (existing?.status === "AMBIGUOUS") throw new GovernedActionError("ACTION_REQUIRES_RECONCILIATION", "A previous execution has an ambiguous external outcome");
        if (existing?.status === RECEIPT_STATUS.IN_PROGRESS && existing.leaseExpiresAt && existing.leaseExpiresAt.getTime() > now.getTime()) return { status: "IN_PROGRESS" };
        if (existing?.status === RECEIPT_STATUS.IN_PROGRESS && !replaySafe) {
          // A dead worker may have committed remotely. A timeout is not proof
          // that the action never happened. Persist quarantine before returning.
          const quarantined = await table.updateMany({
            where: { id: existing.id, workspaceId: tenantId, actionId, version: existing.version, status: RECEIPT_STATUS.IN_PROGRESS },
            data: { status: "AMBIGUOUS", errorCode: "LEASE_EXPIRED_UNKNOWN_OUTCOME", leaseTokenHash: null, leaseExpiresAt: null, version: { increment: 1 } },
          });
          return { status: quarantined.count === 1 ? "RECONCILIATION_REQUIRED" : "IN_PROGRESS" };
        }
        if (!existing) {
          await table.create({ data: { workspaceId: tenantId, actionId, idempotencyKey: key, payloadDigest: digest, status: RECEIPT_STATUS.IN_PROGRESS, leaseTokenHash, leaseExpiresAt, attemptCount: 1 } });
          return { status: "ACQUIRED", lease: Object.freeze({ key, tenantId, actionId, digest, token: lease }) };
        }
        const updated = await table.updateMany({
          where: { id: existing.id, version: existing.version, payloadDigest: digest, OR: [{ status: RECEIPT_STATUS.FAILED }, { status: RECEIPT_STATUS.IN_PROGRESS, leaseExpiresAt: { lte: now } }] },
          data: { status: RECEIPT_STATUS.IN_PROGRESS, leaseTokenHash, leaseExpiresAt, attemptCount: { increment: 1 }, version: { increment: 1 }, errorCode: null },
        });
        if (updated.count !== 1) return { status: "IN_PROGRESS" };
        return { status: "ACQUIRED", lease: Object.freeze({ key, tenantId, actionId, digest, token: lease }) };
      });
      if (acquired.status === "RECONCILIATION_REQUIRED") throw new GovernedActionError("ACTION_REQUIRES_RECONCILIATION", "Expired action execution has an unknown external outcome; reconcile before retrying");
      return acquired;
    } catch (error) {
      if (isUniqueViolation(error) && attempt < maxAcquireAttempts) return acquire({ key, digest, tenantId, actionId, now, replaySafe, minimumLeaseMs }, attempt + 1);
      throw error;
    }
  }

  async function finish({ lease, digest, result, errorCode, now, succeeded }) {
    if (!lease || typeof lease !== "object") throw new GovernedActionError("INVALID_RECEIPT_LEASE", "Receipt lease is required");
    assertString(lease.token, "lease.token"); assertString(digest, "digest"); assertDate(now, "now");
    if (lease.digest !== digest) throw new GovernedActionError("RECEIPT_DIGEST_MISMATCH", "Receipt lease is bound to another payload");
    const table = delegate(prisma, model);
    const updated = await table.updateMany({
      where: { workspaceId: lease.tenantId, actionId: lease.actionId, idempotencyKey: lease.key, payloadDigest: digest, status: RECEIPT_STATUS.IN_PROGRESS, leaseTokenHash: sha256(lease.token) },
      data: succeeded
        ? { status: RECEIPT_STATUS.SUCCEEDED, resultJson: result ?? null, errorCode: null, leaseTokenHash: null, leaseExpiresAt: null, completedAt: now, version: { increment: 1 } }
        : { status: RECEIPT_STATUS.FAILED, errorCode: String(errorCode ?? "ACTION_EXECUTION_FAILED").slice(0, 128), leaseTokenHash: null, leaseExpiresAt: null, completedAt: now, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new GovernedActionError("RECEIPT_LEASE_LOST", "Receipt lease was lost or already finalized");
  }

  async function markAmbiguous({ lease, digest, errorCode, now }) {
    if (!lease || typeof lease !== "object") throw new GovernedActionError("INVALID_RECEIPT_LEASE", "Receipt lease is required");
    assertString(lease.token, "lease.token"); assertString(digest, "digest"); assertDate(now, "now");
    if (lease.digest !== digest) throw new GovernedActionError("RECEIPT_DIGEST_MISMATCH", "Receipt lease is bound to another payload");
    const table = delegate(prisma, model);
    const updated = await table.updateMany({
      where: { workspaceId: lease.tenantId, actionId: lease.actionId, idempotencyKey: lease.key, payloadDigest: digest, status: RECEIPT_STATUS.IN_PROGRESS, leaseTokenHash: sha256(lease.token) },
      data: { status: "AMBIGUOUS", errorCode: String(errorCode ?? "ACTION_OUTCOME_AMBIGUOUS").slice(0, 128), leaseTokenHash: null, leaseExpiresAt: null, completedAt: now, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new GovernedActionError("RECEIPT_LEASE_LOST", "Receipt lease was lost or already finalized");
  }

  return Object.freeze({
    begin: acquire,
    succeed: ({ lease, digest, result, now }) => finish({ lease, digest, result, now, succeeded: true }),
    fail: ({ lease, digest, errorCode, now }) => finish({ lease, digest, errorCode, now, succeeded: false }),
    ambiguous: markAmbiguous,
  });
}

export function createPrismaApprovalStore({ prisma, model = "governedActionApproval" } = {}) {
  if (!prisma) throw new GovernedActionError("INVALID_STORE_CONFIG", "prisma is required");
  return Object.freeze({
    async consume({ approvalId, tenantId, actionId, digest, actorId, now }) {
      assertString(approvalId, "approvalId"); assertString(tenantId, "tenantId"); assertString(actionId, "actionId"); assertString(digest, "digest"); assertString(actorId, "actorId"); assertDate(now, "now");
      return transaction(prisma, async (tx) => {
        const table = delegate(tx, model);
        const updated = await table.updateMany({
          where: { id: approvalId, workspaceId: tenantId, actionId, payloadDigest: digest, requestedById: actorId, status: "APPROVED", consumedAt: null, expiresAt: { gt: now } },
          data: { status: "CONSUMED", consumedAt: now, consumedById: actorId, version: { increment: 1 } },
        });
        return updated.count === 1 ? { consumed: true, tenantId, actionId, digest } : null;
      });
    },
  });
}

export function createPrismaAuditSink({ prisma, model = "governedActionAuditEvent" } = {}) {
  if (!prisma) throw new GovernedActionError("INVALID_STORE_CONFIG", "prisma is required");
  return Object.freeze({
    async append(event) {
      if (!event || typeof event !== "object") throw new GovernedActionError("INVALID_AUDIT_EVENT", "Audit event is required");
      const table = delegate(prisma, model);
      await table.create({ data: {
        workspaceId: assertString(event.tenantId, "event.tenantId"),
        actionId: assertString(event.actionId, "event.actionId"),
        actorId: assertString(event.actorId, "event.actorId"),
        requestId: assertString(event.requestId, "event.requestId"),
        correlationId: String(event.correlationId ?? event.requestId),
        eventType: assertString(event.type, "event.type"),
        payloadDigest: event.details?.digest ? String(event.details.digest) : null,
        detailsJson: redactForAudit(event.details ?? {}),
        occurredAt: event.at ? assertDate(new Date(event.at), "event.at") : new Date(),
      } });
    },
  });
}
