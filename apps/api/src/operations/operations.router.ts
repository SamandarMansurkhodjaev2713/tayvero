import { Inject } from "@nestjs/common";
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { SessionOnlyMiddleware } from "../trpc/middlewares/session-only.middleware";
import { OperationsService } from "./operations.service";
import { continuationsListInput, continuationsListOutput, operationsEmptyInput, operationsCapabilitiesOutput, operationsOverviewInput, operationsOverviewOutput, approvalsListInput, approvalsListOutput, approvalDecisionInput, approvalView } from "./operations.contracts";
@Router({ alias: "operations" })
@UseMiddlewares(AuthMiddleware, SessionOnlyMiddleware)
export class OperationsRouter {
    constructor(
    @Inject(OperationsService)
    private readonly operations: OperationsService) { }
    @Query({ input: operationsEmptyInput, output: operationsCapabilitiesOutput })
    capabilities(
    @Ctx()
    ctx: AuthedTrpcContext) { return this.operations.capabilities(ctx); }
    @Query({ input: operationsOverviewInput, output: operationsOverviewOutput })
    overview(
    @Ctx()
    ctx: AuthedTrpcContext, 
    @Input()
    input: z.infer<typeof operationsOverviewInput>) { return this.operations.overview(ctx, input); }
    @Query({ input: approvalsListInput, output: approvalsListOutput })
    approvals(
    @Ctx()
    ctx: AuthedTrpcContext, 
    @Input()
    input: z.infer<typeof approvalsListInput>) { return this.operations.approvals(ctx, input); }
    @Query({ input: continuationsListInput, output: continuationsListOutput })
    continuations(@Ctx() ctx: AuthedTrpcContext, @Input() input: z.infer<typeof continuationsListInput>) { return this.operations.continuations(ctx, input); }
    @Mutation({ input: approvalDecisionInput, output: approvalView })
    decideApproval(
    @Ctx()
    ctx: AuthedTrpcContext, 
    @Input()
    input: z.infer<typeof approvalDecisionInput>) { return this.operations.decide(ctx, input); }
}
