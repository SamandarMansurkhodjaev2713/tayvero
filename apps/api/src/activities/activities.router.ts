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
import { restMeta } from "../trpc/openapi";
import {
	activityCreateInput,
	activityCreateOutput,
	completeInput,
	completeOutput,
	myTasksInput,
	myTasksOutput,
	taskHistoryInput,
	taskHistoryOutput,
	taskIdInput,
	taskQueueInput,
	taskQueueOutput,
	taskUpdateInput,
	timelineCountsInput,
	timelineCountsOutput,
	timelineInput,
	timelineOutput,
} from "./activities.contracts";
import { ActivitiesService } from "./activities.service";

@Router({ alias: "activities" })
@UseMiddlewares(AuthMiddleware)
export class ActivitiesRouter {
	constructor(
		@Inject(ActivitiesService) private readonly activities: ActivitiesService,
	) {}

	@Query({
		input: timelineInput,
		output: timelineOutput,
		meta: restMeta("GET", "/activities", ["Activities"]),
	})
	async timeline(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof timelineInput>,
	) {
		return this.activities.timeline(input, ctx.user.id);
	}

	@Query({
		input: timelineCountsInput,
		output: timelineCountsOutput,
		meta: restMeta("GET", "/activities/counts", ["Activities"]),
	})
	async timelineCounts(@Input() input: z.infer<typeof timelineCountsInput>) {
		return this.activities.timelineCounts(input);
	}

	@Query({
		input: myTasksInput,
		output: myTasksOutput,
		meta: restMeta("GET", "/activities/my-tasks", ["Activities"]),
	})
	async myTasks(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof myTasksInput>,
	) {
		return this.activities.myTasks(input, ctx.user.id);
	}

	@Mutation({
		input: activityCreateInput,
		output: activityCreateOutput,
		meta: restMeta("POST", "/activities", ["Activities"]),
	})
	async create(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof activityCreateInput>,
	) {
		return this.activities.create(input, ctx.user.id);
	}

	@Mutation({
		input: completeInput,
		output: completeOutput,
		meta: restMeta("PATCH", "/activities/{id}/complete", ["Activities"]),
	})
	async complete(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof completeInput>,
	) {
		return this.activities.complete(
			input.id,
			input.completed,
			ctx.user.id,
			input.expectedVersion,
		);
	}

	@Query({
		input: taskQueueInput,
		output: taskQueueOutput,
		meta: restMeta("POST", "/tasks/search", ["Activities"]),
	})
	taskQueue(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof taskQueueInput>,
	) {
		return this.activities.taskQueue(input, ctx.user.id);
	}
	@Query({
		input: taskIdInput,
		output: activityCreateOutput,
		meta: restMeta("GET", "/tasks/{id}", ["Activities"]),
	})
	taskById(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof taskIdInput>,
	) {
		return this.activities.taskById(input.id, ctx.user.id);
	}
	@Mutation({
		input: taskUpdateInput,
		output: activityCreateOutput,
		meta: restMeta("PATCH", "/tasks/{id}", ["Activities"]),
	})
	updateTask(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof taskUpdateInput>,
	) {
		return this.activities.updateTask(input, ctx.user.id);
	}
	@Query({
		input: taskHistoryInput,
		output: taskHistoryOutput,
		meta: restMeta("GET", "/tasks/{id}/history", ["Activities"]),
	})
	taskHistory(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof taskHistoryInput>,
	) {
		return this.activities.taskHistory(input.id, input.limit, ctx.user.id);
	}
}
