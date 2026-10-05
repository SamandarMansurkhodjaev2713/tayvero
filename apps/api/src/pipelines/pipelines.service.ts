import { randomUUID } from "node:crypto";
import { isWorkspaceRole } from "@crm/auth";
import type { Db } from "@crm/db";
import {
	createPipelineRuntime,
	createPrismaPipelineRepository,
	type PipelineRuntime,
	type PipelineRuntimeContext,
	PipelineRuntimeError,
} from "@crm/pipeline-runtime";
import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	InternalServerErrorException,
	Logger,
	NotFoundException,
	PreconditionFailedException,
	UnauthorizedException,
} from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { getRequestContext } from "../logging/request-context";
import type { AuthedTrpcContext } from "../trpc/context.types";
import {
	canManagePipelines,
	createDeterministicPipelineIdFactory,
	createPipelineDefinition,
	isPipelineInputError,
	type PipelineApiOutput,
	permissionsForWorkspaceRole,
	pipelineCreateCommandPayload,
	pipelineUpdateCommandPayload,
	toPipelineApiModel,
	updatePipelineDefinition,
} from "./pipeline-api-core.mjs";
import type {
	PipelineCreateInput,
	PipelineStateCommandInput,
	PipelineUpdateInput,
} from "./pipelines.contracts";

type PipelinePrincipal = {
	context: PipelineRuntimeContext;
	canManage: boolean;
};

const CONFLICT_CODES = new Set([
	"ASSIGNMENT_EXISTS",
	"DEFAULT_PIPELINE_ARCHIVE",
	"IDEMPOTENCY_KEY_REUSED",
	"OPEN_DEALS_EXIST",
	"PIPELINE_ARCHIVED",
	"PIPELINE_DEFAULT_CONFLICT",
	"PIPELINE_EXISTS",
	"PIPELINE_LIMIT",
	"PIPELINE_SLUG_EXISTS",
	"PIPELINE_STAGE_CONFLICT",
	"PIPELINE_STATE_CHANGE_REQUIRES_DEDICATED_COMMAND",
	"RECEIPT_EXISTS",
	"STAGE_IN_USE",
	"STAGE_TYPE_IN_USE",
	"STALE_ASSIGNMENT",
	"STALE_PIPELINE",
]);
const NOT_FOUND_CODES = new Set([
	"ASSIGNMENT_NOT_FOUND",
	"PIPELINE_NOT_FOUND",
	"PIPELINE_STAGE_NOT_FOUND",
]);
const INTERNAL_RUNTIME_CODES = new Set([
	"CORRUPT_PIPELINE_DATA",
	"INVALID_GENERATED_ID",
	"INVALID_REPOSITORY",
	"NESTED_TRANSACTION_UNSUPPORTED",
	"PRISMA_ADAPTER_CONFIGURATION",
	"TRANSACTION_RETRY_EXHAUSTED",
]);
const SAFE_WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/;

function expiryTimestamp(value: unknown): number | null {
	if (value instanceof Date) {
		const timestamp = value.getTime();
		return Number.isFinite(timestamp) ? timestamp : null;
	}
	if (typeof value === "string" || typeof value === "number") {
		const timestamp = new Date(value).getTime();
		return Number.isFinite(timestamp) ? timestamp : null;
	}
	return null;
}

@Injectable()
export class PipelinesService {
	private readonly logger = new Logger(PipelinesService.name);
	private readonly runtime: PipelineRuntime;

	constructor(@InjectDatabase() private readonly db: Db) {
		this.runtime = createPipelineRuntime({
			repository: createPrismaPipelineRepository(db),
		});
	}

	async list(
		ctx: AuthedTrpcContext,
		includeArchived: boolean,
	): Promise<{ items: PipelineApiOutput[]; canManage: boolean }> {
		const principal = await this.principal(ctx);
		return this.execute(async () => {
			const pipelines = await this.runtime.listPipelines(principal.context);
			return {
				items: pipelines
					.filter((pipeline) => includeArchived || !pipeline.isArchived)
					.map((pipeline) => toPipelineApiModel(pipeline, principal.canManage)),
				canManage: principal.canManage,
			};
		});
	}

	async byId(
		ctx: AuthedTrpcContext,
		pipelineId: string,
	): Promise<PipelineApiOutput> {
		const principal = await this.principal(ctx);
		return this.execute(async () => {
			const pipeline = await this.runtime.getPipeline(
				principal.context,
				pipelineId,
			);
			if (!pipeline) throw new NotFoundException("Pipeline was not found.");
			return toPipelineApiModel(pipeline, principal.canManage);
		});
	}

	async create(
		ctx: AuthedTrpcContext,
		input: PipelineCreateInput,
	): Promise<PipelineApiOutput> {
		const principal = await this.principal(ctx);
		return this.execute(async () => {
			const commandPayload = pipelineCreateCommandPayload(input);
			const replay = await this.runtime.replayCommand({
				context: principal.context,
				action: "pipeline.create",
				idempotencyKey: input.idempotencyKey,
				payload: commandPayload,
			});
			if (replay.found) {
				return toPipelineApiModel(replay.result, principal.canManage);
			}

			const definition = createPipelineDefinition({
				tenantId: principal.context.tenantId,
				input,
				idFactory: createDeterministicPipelineIdFactory({
					tenantId: principal.context.tenantId,
					idempotencyKey: input.idempotencyKey,
				}),
			});
			const created = await this.runtime.createPipeline({
				context: principal.context,
				idempotencyKey: input.idempotencyKey,
				definition,
				idempotencyPayload: commandPayload,
			});
			this.logger.log({
				message: "Pipeline created",
				pipelineId: created.id,
				tenantId: principal.context.tenantId,
				actorId: principal.context.actorId,
			});
			return toPipelineApiModel(created, principal.canManage);
		});
	}

	async update(
		ctx: AuthedTrpcContext,
		input: PipelineUpdateInput,
	): Promise<PipelineApiOutput> {
		const principal = await this.principal(ctx);
		return this.execute(async () => {
			const commandPayload = pipelineUpdateCommandPayload(input);
			const replay = await this.runtime.replayCommand({
				context: principal.context,
				action: "pipeline.update",
				idempotencyKey: input.idempotencyKey,
				payload: commandPayload,
			});
			if (replay.found) {
				return toPipelineApiModel(replay.result, principal.canManage);
			}

			const current = await this.runtime.getPipeline(
				principal.context,
				input.id,
			);
			if (!current) throw new NotFoundException("Pipeline was not found.");
			const definition = updatePipelineDefinition({
				current,
				input,
				idFactory: createDeterministicPipelineIdFactory({
					tenantId: principal.context.tenantId,
					idempotencyKey: input.idempotencyKey,
				}),
			});

			const legacyMappings = await this.db.crmLegacyDealStageMapping.findMany({
				where: {
					workspaceId: principal.context.tenantId,
					pipelineId: current.id,
				},
				select: { legacyStage: true, stageId: true },
			});
			if (legacyMappings.length > 0) {
				const currentStageById = new Map(
					current.stages.map((stage) => [stage.id, stage]),
				);
				const nextStageById = new Map(
					definition.stages.map((stage) => [stage.id, stage]),
				);
				const incompatible = legacyMappings.find((mapping) => {
					const previous = currentStageById.get(mapping.stageId);
					const next = nextStageById.get(mapping.stageId);
					return !previous || !next || previous.type !== next.type;
				});
				if (incompatible) {
					throw new ConflictException(
						`Stage ${incompatible.stageId} is mapped from legacy DealStage ${incompatible.legacyStage}. Remap and reconcile legacy stages before removing it or changing its outcome type.`,
					);
				}
			}

			const updated = await this.runtime.updatePipeline({
				context: principal.context,
				idempotencyKey: input.idempotencyKey,
				definition,
				expectedVersion: input.expectedVersion,
				idempotencyPayload: commandPayload,
			});
			this.logger.log({
				message: "Pipeline updated",
				pipelineId: updated.id,
				tenantId: principal.context.tenantId,
				actorId: principal.context.actorId,
				version: updated.version,
			});
			return toPipelineApiModel(updated, principal.canManage);
		});
	}

	async setDefault(
		ctx: AuthedTrpcContext,
		input: PipelineStateCommandInput,
	): Promise<PipelineApiOutput> {
		const principal = await this.principal(ctx);
		return this.execute(async () => {
			if (
				process.env.CRM_PIPELINE_DUAL_WRITE_MODE?.trim().toLowerCase() ===
				"strict"
			) {
				const mappings = await this.db.crmLegacyDealStageMapping.findMany({
					where: { workspaceId: principal.context.tenantId },
					select: { pipelineId: true },
				});
				if (mappings.some((mapping) => mapping.pipelineId !== input.id)) {
					throw new ConflictException(
						"Disable strict deal-pipeline dual-write, migrate every legacy stage mapping to the new default pipeline, reconcile to zero, then re-enable strict mode.",
					);
				}
			}
			return toPipelineApiModel(
				await this.runtime.setDefaultPipeline({
					context: principal.context,
					idempotencyKey: input.idempotencyKey,
					pipelineId: input.id,
					expectedVersion: input.expectedVersion,
				}),
				principal.canManage,
			);
		});
	}

	async archive(
		ctx: AuthedTrpcContext,
		input: PipelineStateCommandInput,
	): Promise<PipelineApiOutput> {
		const principal = await this.principal(ctx);
		return this.execute(async () =>
			toPipelineApiModel(
				await this.runtime.archivePipeline({
					context: principal.context,
					idempotencyKey: input.idempotencyKey,
					pipelineId: input.id,
					expectedVersion: input.expectedVersion,
				}),
				principal.canManage,
			),
		);
	}

	async restore(
		ctx: AuthedTrpcContext,
		input: PipelineStateCommandInput,
	): Promise<PipelineApiOutput> {
		const principal = await this.principal(ctx);
		return this.execute(async () =>
			toPipelineApiModel(
				await this.runtime.restorePipeline({
					context: principal.context,
					idempotencyKey: input.idempotencyKey,
					pipelineId: input.id,
					expectedVersion: input.expectedVersion,
				}),
				principal.canManage,
			),
		);
	}

	private async principal(ctx: AuthedTrpcContext): Promise<PipelinePrincipal> {
		const session = ctx.session;
		if (!session || session.user.id !== ctx.user.id) {
			throw new UnauthorizedException("A valid signed-in session is required.");
		}
		const expiresAt = expiryTimestamp(session.session.expiresAt);
		if (expiresAt === null || expiresAt <= Date.now()) {
			throw new UnauthorizedException("The session has expired.");
		}
		const workspaceId =
			"activeOrganizationId" in session.session &&
			typeof session.session.activeOrganizationId === "string"
				? session.session.activeOrganizationId.trim()
				: undefined;
		if (!workspaceId) {
			throw new PreconditionFailedException(
				"Select an active workspace before managing pipelines.",
			);
		}
		if (!SAFE_WORKSPACE_ID.test(workspaceId)) {
			throw new UnauthorizedException("The active workspace is invalid.");
		}
		const membership = await this.db.member.findUnique({
			where: {
				organizationId_userId: {
					organizationId: workspaceId,
					userId: ctx.user.id,
				},
			},
			select: { role: true },
		});
		if (!membership || !isWorkspaceRole(membership.role)) {
			throw new ForbiddenException(
				"You are not an active member of this workspace.",
			);
		}
		return {
			context: {
				tenantId: workspaceId,
				actorId: ctx.user.id,
				requestId: getRequestContext()?.requestId ?? randomUUID(),
				permissions: permissionsForWorkspaceRole(membership.role),
			},
			canManage: canManagePipelines(membership.role),
		};
	}

	private async execute<T>(operation: () => Promise<T>): Promise<T> {
		try {
			return await operation();
		} catch (error) {
			if (
				error instanceof NotFoundException ||
				error instanceof ConflictException ||
				error instanceof ForbiddenException ||
				error instanceof UnauthorizedException ||
				error instanceof PreconditionFailedException
			) {
				throw error;
			}
			if (error instanceof PipelineRuntimeError) {
				if (NOT_FOUND_CODES.has(error.code)) {
					throw new NotFoundException(error.message);
				}
				if (error.code === "PERMISSION_DENIED") {
					throw new ForbiddenException(error.message);
				}
				if (CONFLICT_CODES.has(error.code)) {
					throw new ConflictException(error.message);
				}
				if (INTERNAL_RUNTIME_CODES.has(error.code)) {
					this.logUnexpected(error);
					throw new InternalServerErrorException(
						"The pipeline operation could not be completed.",
					);
				}
				throw new BadRequestException(error.message);
			}
			if (isPipelineInputError(error)) {
				if (error.code === "STALE_PIPELINE") {
					throw new ConflictException(error.message);
				}
				if (
					error.code === "CORRUPT_TRANSITION" ||
					error.code === "INVALID_GENERATED_ID"
				) {
					this.logUnexpected(error);
					throw new InternalServerErrorException(
						"The pipeline operation could not be completed.",
					);
				}
				throw new BadRequestException(error.message);
			}
			this.logUnexpected(error);
			throw new InternalServerErrorException(
				"The pipeline operation could not be completed.",
			);
		}
	}

	private logUnexpected(error: unknown): void {
		this.logger.error(
			{ message: "Pipeline operation failed" },
			error instanceof Error ? error.stack : String(error),
		);
	}
}
