
import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { SessionOnlyMiddleware } from "../trpc/middlewares/session-only.middleware";
import { restMeta } from "../trpc/openapi";
import {
	pipelineArchiveInput,
	pipelineCreateInput,
	pipelineIdInput,
	pipelineListInput,
	pipelineListOutput,
	pipelineOutput,
	pipelineRestoreInput,
	pipelineSetDefaultInput,
	pipelineUpdateInput,
} from "./pipelines.contracts";
import { PipelinesService } from "./pipelines.service";

@Router({ alias: "pipelines" })
@UseMiddlewares(AuthMiddleware, SessionOnlyMiddleware)
export class PipelinesRouter {
	constructor(
		@Inject(PipelinesService) private readonly pipelines: PipelinesService,
	) {}

	@Query({
		input: pipelineListInput,
		output: pipelineListOutput,
		meta: restMeta("GET", "/pipelines", ["Pipelines"]),
	})
	async list(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof pipelineListInput>,
	) {
		return this.pipelines.list(ctx, input.includeArchived);
	}

	@Query({
		input: pipelineIdInput,
		output: pipelineOutput,
		meta: restMeta("GET", "/pipelines/{id}", ["Pipelines"]),
	})
	async byId(@Ctx() ctx: AuthedTrpcContext, @Input("id") id: string) {
		return this.pipelines.byId(ctx, id);
	}

	@Mutation({
		input: pipelineCreateInput,
		output: pipelineOutput,
		meta: restMeta("POST", "/pipelines", ["Pipelines"]),
	})
	async create(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof pipelineCreateInput>,
	) {
		return this.pipelines.create(ctx, input);
	}

	@Mutation({
		input: pipelineUpdateInput,
		output: pipelineOutput,
		meta: restMeta("PUT", "/pipelines/{id}", ["Pipelines"]),
	})
	async update(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof pipelineUpdateInput>,
	) {
		return this.pipelines.update(ctx, input);
	}

	@Mutation({
		input: pipelineSetDefaultInput,
		output: pipelineOutput,
		meta: restMeta("POST", "/pipelines/{id}/default", ["Pipelines"]),
	})
	async setDefault(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof pipelineSetDefaultInput>,
	) {
		return this.pipelines.setDefault(ctx, input);
	}

	@Mutation({
		input: pipelineArchiveInput,
		output: pipelineOutput,
		meta: restMeta("POST", "/pipelines/{id}/archive", ["Pipelines"]),
	})
	async archive(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof pipelineArchiveInput>,
	) {
		return this.pipelines.archive(ctx, input);
	}

	@Mutation({
		input: pipelineRestoreInput,
		output: pipelineOutput,
		meta: restMeta("POST", "/pipelines/{id}/restore", ["Pipelines"]),
	})
	async restore(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof pipelineRestoreInput>,
	) {
		return this.pipelines.restore(ctx, input);
	}
}
