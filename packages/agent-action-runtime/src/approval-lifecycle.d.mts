export type ApprovalContext = Readonly<{ tenantId: string; actorId: string }>;
export type ApprovalDecision = "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED";
export type ApprovalCursor = { createdAt: string; id: string };
export type ApprovalSnapshot = { source: "GOVERNED_EXECUTOR"; title: string; manifestVersion: string; risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; mutating: boolean; inputSha256: string; preview: unknown; previewComplete: boolean };
export type BoundApproval = {
  id: string; actionId: string; payloadDigest: string; status: string; persistedStatus: string; version: number;
  requestedById: string; requesterUserId: string | null; runId: string | null; createdAt: string; expiresAt: string;
  decidedAt: string | null; decidedById: string | null; decisionReason: string | null;
  snapshot: ApprovalSnapshot | null; legacyUnbound: boolean; canApprove: boolean; canReject: boolean; canCancel: boolean; startsExecution: false;
};
export interface ApprovalLifecycle {
  request(input: { context: ApprovalContext & { requestId: string; correlationId?: string }; actionId: string; digest: string; manifestVersion: string; title: string; risk: ApprovalSnapshot["risk"]; mutating: boolean; executionKey: string; input: unknown }): Promise<BoundApproval>;
  list(context: ApprovalContext, input?: { status?: string; before?: ApprovalCursor | null }): Promise<{ items: BoundApproval[]; next: ApprovalCursor | null; at: string }>;
  decide(context: ApprovalContext, input: { approvalId: string; expectedVersion: number; expectedDigest: string; decision: ApprovalDecision; reason?: string }): Promise<BoundApproval>;
  consume(input: { approvalId: string; tenantId: string; actionId: string; digest: string; actorId: string; executionKey: string; now?: Date }): Promise<{ consumed: true; tenantId: string; actionId: string; digest: string } | null>;
}
export function createPrismaApprovalLifecycle(options: { prisma: unknown; workspaceId: string; clock?: () => Date; ttlMs?: number }): ApprovalLifecycle;
