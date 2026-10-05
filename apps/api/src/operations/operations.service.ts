import { WORKSPACE_ID } from "@crm/auth";
import type { Db } from "@crm/db";
import { HttpException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { z } from "zod";
import { InjectDatabase } from "../database/database.constants";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { requireDeploymentMembership } from "../trpc/workspace-access.mjs";
import { createAgentOperations, publicOperationsError, type AgentOperations, type OperationsContext } from "./operations-core.mjs";
import type * as C from "./operations.contracts";
@Injectable()
export class OperationsService {
    private readonly operations: AgentOperations;
    constructor(
    @InjectDatabase()
    private readonly db: Db) { this.operations = createAgentOperations({ prisma: db, workspaceId: WORKSPACE_ID, approvalsEnabled: process.env.AGENT_APPROVAL_CENTER_ENABLED === "1", continuationsEnabled: process.env.AGENT_APPROVAL_CENTER_ENABLED === "1" && process.env.AGENT_APPROVAL_CONTINUATION_ENABLED === "1" }); }
    private async call<T>(ctx: AuthedTrpcContext, operation: (context: OperationsContext) => Promise<T>): Promise<T> {
        if (!ctx.user || ctx.user.id !== ctx.session?.user.id)
            throw new UnauthorizedException("A signed-in session is required.");
        const member = await requireDeploymentMembership({ session: ctx.session, workspaceId: WORKSPACE_ID, findMembership: ({ workspaceId, userId }) => this.db.member.findUnique({ where: { organizationId_userId: { organizationId: workspaceId, userId } }, select: { role: true } }) });
        try {
            return await operation({ tenantId: member.workspaceId, actorId: member.userId });
        }
        catch (error) {
            const safe = publicOperationsError(error);
            throw new HttpException(safe.message, safe.status);
        }
    }
    capabilities(ctx: AuthedTrpcContext) { return this.call(ctx, c => this.operations.capabilities(c)); }
    overview(ctx: AuthedTrpcContext, input: z.infer<typeof C.operationsOverviewInput>) { return this.call(ctx, c => this.operations.overview(c, input)); }
    approvals(ctx: AuthedTrpcContext, input: z.infer<typeof C.approvalsListInput>) { return this.call(ctx, c => this.operations.approvals(c, input)); }
    continuations(ctx: AuthedTrpcContext, input: z.infer<typeof C.continuationsListInput>) { return this.call(ctx, c => this.operations.continuations(c, input)); }
    decide(ctx: AuthedTrpcContext, input: z.infer<typeof C.approvalDecisionInput>) { return this.call(ctx, c => this.operations.decide(c, input)); }
}
