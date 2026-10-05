import { z } from "zod";
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,511}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
const nullableTime = z.string().nullable();
const cursor = z.object({ createdAt: z.string().datetime(), id }).strict();
export const operationsEmptyInput = z.object({}).strict();
export const operationsOverviewInput = z.object({ hours: z.union([z.literal(24), z.literal(168)]).default(24) }).strict();
export const operationsCapabilitiesOutput = z.object({ approvalsEnabled: z.boolean(), continuationsEnabled: z.boolean(), dedicatedWorkspace: z.literal(true), businessOutcomesInstrumented: z.literal(false), liveProviderHealthVerified: z.literal(false), scope: z.string(), rowLimit: count });
const run = z.object({ id, agentId: id, agentName: z.string(), versionId: id, status: z.string(), costUsd: z.string().nullable(), createdAt: nullableTime, startedAt: nullableTime, finishedAt: nullableTime, errorCode: z.string().nullable() });
const action = z.object({ id, agentId: id, agentName: z.string(), runId: id, type: z.string(), provider: z.string(), targetType: z.string().nullable(), targetId: z.string().nullable(), status: z.string(), attemptCount: count, errorCode: z.string().nullable(), plannedAt: nullableTime, completedAt: nullableTime, reconciliationRequired: z.boolean() });
export const operationsOverviewOutput = z.object({ window: z.object({ from: z.string(), to: z.string(), hours: count }), metrics: z.object({ runCount: count, complete: z.boolean(), counts: z.record(z.string(), count).nullable(), successRatePercent: z.number().nullable(), recordedAiCostUsd: z.string().nullable(), runsWithRecordedCost: count.nullable(), runsWithoutRecordedCost: count.nullable(), outcomeValue: z.null(), validatedTimeSaved: z.null(), costMeaning: z.string(), successMeaning: z.string(), activeAgents: count, pendingApprovals: count.nullable(), actionCount: count, actionCoverageComplete: z.boolean(), incidentCount: count.nullable() }), agents: z.array(z.object({ id, name: z.string(), status: z.string(), updatedAt: nullableTime })), runs: z.array(run), actions: z.array(action), incidents: z.array(z.object({ actionId: id, runId: id, agentId: id, agentName: z.string(), type: z.string(), errorCode: z.string().nullable(), at: nullableTime, safeToAutomaticallyRetry: z.literal(false) })), displayedRowLimit: count, incidentMeaning: z.string(), health: z.object({ readAt: z.string(), liveProvidersVerified: z.literal(false), outcomeLedgerImplemented: z.literal(false), dataSource: z.string(), windowLimited: z.boolean(), receiptCorrelationComplete: z.boolean(), actionsWithoutReceiptLink: count }) });
export const approvalsListInput = z.object({ status: z.enum(["ALL", "PENDING", "APPROVED", "REJECTED", "EXPIRED", "CANCELLED", "CONSUMED"]).default("PENDING"), before: cursor.nullable().default(null) }).strict();
const snapshot = z.object({ source: z.literal("GOVERNED_EXECUTOR"), title: z.string(), manifestVersion: z.string(), risk: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]), mutating: z.boolean(), inputSha256: digest, preview: z.unknown(), previewComplete: z.boolean() });
export const approvalView = z.object({ id, actionId: z.string(), payloadDigest: digest, status: z.string(), persistedStatus: z.string(), version: count, requestedById: id, requesterUserId: id.nullable(), runId: id.nullable(), createdAt: z.string(), expiresAt: z.string(), decidedAt: nullableTime, decidedById: id.nullable(), decisionReason: z.string().nullable(), snapshot: snapshot.nullable(), legacyUnbound: z.boolean(), canApprove: z.boolean(), canReject: z.boolean(), canCancel: z.boolean(), startsExecution: z.literal(false) });
export const approvalsListOutput = z.object({ items: z.array(approvalView), next: cursor.nullable(), at: z.string() });
export const approvalDecisionInput = z.object({ approvalId: id, expectedVersion: count, expectedDigest: digest, decision: z.enum(["APPROVED", "REJECTED", "CANCELLED", "EXPIRED"]), reason: z.string().max(500).default("") }).strict();

export const continuationsListInput = z.object({ status: z.enum(["ACTIVE", "ATTENTION", "ALL"]).default("ACTIVE"), before: cursor.nullable().default(null) }).strict();
export const continuationsListOutput = z.object({ items: z.array(z.object({
  id, approvalId: id, runId: id, callId: id, toolName: z.string(), status: z.string(), decision: z.enum(["approve", "deny"]).nullable(),
  errorCode: z.string().nullable(), createdAt: z.string(), waitingAt: nullableTime, deliveredAt: nullableTime,
  completedAt: nullableTime, updatedAt: z.string(), safeToAutomaticallyRetry: z.literal(false),
})), next: cursor.nullable(), at: z.string(), backgroundScheduleVerified: z.literal(false) });
