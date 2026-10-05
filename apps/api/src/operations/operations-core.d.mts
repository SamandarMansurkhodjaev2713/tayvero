import type { z } from "zod";
import type * as C from "./operations.contracts";
export type OperationsContext = { tenantId: string; actorId: string };
export type AgentOperations = {
	capabilities(
		context: OperationsContext,
	): Promise<z.infer<typeof C.operationsCapabilitiesOutput>>;
	overview(
		context: OperationsContext,
		input: z.infer<typeof C.operationsOverviewInput>,
	): Promise<z.infer<typeof C.operationsOverviewOutput>>;
	approvals(
		context: OperationsContext,
		input: z.infer<typeof C.approvalsListInput>,
	): Promise<z.infer<typeof C.approvalsListOutput>>;
	continuations(
		context: OperationsContext,
		input: z.infer<typeof C.continuationsListInput>,
	): Promise<z.infer<typeof C.continuationsListOutput>>;
	decide(
		context: OperationsContext,
		input: z.infer<typeof C.approvalDecisionInput>,
	): Promise<z.infer<typeof C.approvalView>>;
};
export function createAgentOperations(options: {
	prisma: unknown;
	workspaceId: string;
	clock?: () => Date;
	approvalsEnabled?: boolean;
	continuationsEnabled?: boolean;
}): AgentOperations;
export function publicOperationsError(error: unknown): {
	status: number;
	message: string;
};
export function summarizeRunWindow(rows: unknown[], total: number): unknown;

export function governedReceiptDigest(action: unknown): string | null;
