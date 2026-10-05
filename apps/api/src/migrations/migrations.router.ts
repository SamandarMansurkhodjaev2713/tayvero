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
import {
	migrationBackgroundInput,
	migrationBackgroundOutput,
	migrationCancelOutput,
	migrationCapabilitiesOutput,
	migrationCleanupInput,
	migrationCleanupOutput,
	migrationEmptyInput,
	migrationExecuteOutput,
	migrationExportOutput,
	migrationJobInput,
	migrationListOutput,
	migrationPrepareInput,
	migrationPrepareOutput,
	migrationPreviewOutput,
	migrationRemoveSourceOutput,
	migrationReportInput,
	migrationReportOutput,
	migrationRollbackInput,
	migrationRollbackOutput,
	migrationSourceInput,
	migrationUploadInput,
} from "./migrations.contracts";
import { MigrationsService } from "./migrations.service";
@Router({ alias: "migrations" })
@UseMiddlewares(AuthMiddleware, SessionOnlyMiddleware)
export class MigrationsRouter {
	constructor(
		@Inject(MigrationsService)
		private readonly migrations: MigrationsService,
	) {}
	@Query({ input: migrationEmptyInput, output: migrationCapabilitiesOutput })
	capabilities(
		@Ctx()
		ctx: AuthedTrpcContext,
	) {
		return this.migrations.capabilities(ctx);
	}
	@Query({ input: migrationEmptyInput, output: migrationListOutput })
	list(
		@Ctx()
		ctx: AuthedTrpcContext,
	) {
		return this.migrations.list(ctx);
	}
	@Mutation({ input: migrationUploadInput, output: migrationPreviewOutput })
	upload(
		@Ctx()
		ctx: AuthedTrpcContext,
		@Input()
		input: z.infer<typeof migrationUploadInput>,
	) {
		return this.migrations.upload(ctx, input);
	}
	@Query({ input: migrationSourceInput, output: migrationPreviewOutput })
	preview(
		@Ctx()
		ctx: AuthedTrpcContext,
		@Input()
		input: z.infer<typeof migrationSourceInput>,
	) {
		return this.migrations.preview(ctx, input);
	}
	@Mutation({ input: migrationPrepareInput, output: migrationPrepareOutput })
	prepare(
		@Ctx()
		ctx: AuthedTrpcContext,
		@Input()
		input: z.infer<typeof migrationPrepareInput>,
	) {
		return this.migrations.prepare(ctx, input);
	}
	@Mutation({ input: migrationJobInput, output: migrationExecuteOutput })
	executeNext(
		@Ctx()
		ctx: AuthedTrpcContext,
		@Input()
		input: z.infer<typeof migrationJobInput>,
	) {
		return this.migrations.executeNext(ctx, input);
	}
	@Mutation({ input: migrationJobInput, output: migrationCancelOutput })
	cancel(
		@Ctx()
		ctx: AuthedTrpcContext,
		@Input()
		input: z.infer<typeof migrationJobInput>,
	) {
		return this.migrations.cancel(ctx, input);
	}
	@Query({ input: migrationReportInput, output: migrationReportOutput })
	report(
		@Ctx()
		ctx: AuthedTrpcContext,
		@Input()
		input: z.infer<typeof migrationReportInput>,
	) {
		return this.migrations.report(ctx, input);
	}
	@Mutation({ input: migrationJobInput, output: migrationExportOutput })
	exportReport(
		@Ctx()
		ctx: AuthedTrpcContext,
		@Input()
		input: z.infer<typeof migrationJobInput>,
	) {
		return this.migrations.exportReport(ctx, input);
	}
	@Mutation({ input: migrationRollbackInput, output: migrationRollbackOutput })
	rollback(
		@Ctx()
		ctx: AuthedTrpcContext,
		@Input()
		input: z.infer<typeof migrationRollbackInput>,
	) {
		return this.migrations.rollback(ctx, input);
	}
	@Mutation({
		input: migrationSourceInput,
		output: migrationRemoveSourceOutput,
	})
	removeSource(
		@Ctx()
		ctx: AuthedTrpcContext,
		@Input()
		input: z.infer<typeof migrationSourceInput>,
	) {
		return this.migrations.removeSource(ctx, input);
	}
	@Mutation({ input: migrationCleanupInput, output: migrationCleanupOutput })
	cleanupSources(
		@Ctx()
		ctx: AuthedTrpcContext,
		@Input()
		input: z.infer<typeof migrationCleanupInput>,
	) {
		return this.migrations.cleanupSources(ctx, input);
	}
	@Mutation({
		input: migrationBackgroundInput,
		output: migrationBackgroundOutput,
	})
	setBackground(
		@Ctx()
		ctx: AuthedTrpcContext,
		@Input()
		input: z.infer<typeof migrationBackgroundInput>,
	) {
		return this.migrations.setBackground(ctx, input);
	}
}
