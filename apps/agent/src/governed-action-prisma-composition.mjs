import {
  createPrismaApprovalStore,
  createPrismaApprovalLifecycle,
  createPrismaAuditSink,
  createPrismaReceiptStore,
} from "@crm/agent-action-runtime";
import { createAgentActionExecutionService } from "./governed-action-execution.mjs";

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertFunction(value, field) {
  if (typeof value !== "function") throw new TypeError(`${field} must be a function`);
  return value;
}

export function createPrismaBackedAgentActionExecution(options) {
  if (!isPlainRecord(options)) throw new TypeError("options must be a plain object");
  const {
    prisma,
    registry,
    authorizer,
    policyEvaluator,
    clock,
    receiptModel = "governedActionReceipt",
    approvalModel = "governedActionApproval",
    auditModel = "governedActionAuditEvent",
    approvalLifecycleWorkspaceId,
    receiptLeaseMs = 30_000,
    maxReceiptAcquireAttempts = 3,
  } = options;

  if (!prisma || typeof prisma !== "object") throw new TypeError("prisma is required");
  if (!registry) throw new TypeError("registry is required");
  assertFunction(authorizer, "authorizer");
  assertFunction(policyEvaluator, "policyEvaluator");
  if (clock !== undefined) assertFunction(clock, "clock");

  return createAgentActionExecutionService({
    registry,
    authorizer,
    policyEvaluator,
    clock,
    receiptStore: createPrismaReceiptStore({
      prisma,
      model: receiptModel,
      leaseMs: receiptLeaseMs,
      maxAcquireAttempts: maxReceiptAcquireAttempts,
    }),
    approvalStore: approvalLifecycleWorkspaceId
      ? createPrismaApprovalLifecycle({ prisma, workspaceId: approvalLifecycleWorkspaceId, clock })
      : createPrismaApprovalStore({ prisma, model: approvalModel }),
    auditSink: createPrismaAuditSink({ prisma, model: auditModel }),
  });
}
