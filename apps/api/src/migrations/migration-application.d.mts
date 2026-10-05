import type { z } from "zod";
import type * as C from "./migrations.contracts";
export type MigrationContext = {
	tenantId: string;
	actorId: string;
};
export class MigrationApplicationError extends Error {
	code: string;
	retryable: boolean;
}
export interface MigrationApplication {
	cleanupSources(
		context: MigrationContext,
		input?: {
			cutoff?: string;
			apply?: boolean;
			expectedPlanHash?: string;
		},
	): Promise<z.infer<typeof C.migrationCleanupOutput>>;
	setBackground(
		context: MigrationContext,
		input: z.infer<typeof C.migrationBackgroundInput>,
	): Promise<z.infer<typeof C.migrationBackgroundOutput>>;
	runBackgroundOnce(input?: { limit?: number; signal?: AbortSignal }): Promise<{
		results: Array<{
			jobId: string;
			status: string;
			acknowledged: boolean;
			state?: string;
			code?: string | null;
		}>;
		examined: number;
		stopped: boolean;
	}>;
	capabilities(
		context: MigrationContext,
	): Promise<z.infer<typeof C.migrationCapabilitiesOutput>>;
	list(
		context: MigrationContext,
	): Promise<z.infer<typeof C.migrationListOutput>>;
	upload(
		context: MigrationContext,
		input: z.infer<typeof C.migrationUploadInput>,
	): Promise<z.infer<typeof C.migrationPreviewOutput>>;
	preview(
		context: MigrationContext,
		input: z.infer<typeof C.migrationSourceInput>,
	): Promise<z.infer<typeof C.migrationPreviewOutput>>;
	prepare(
		context: MigrationContext,
		input: z.infer<typeof C.migrationPrepareInput>,
	): Promise<z.infer<typeof C.migrationPrepareOutput>>;
	executeNext(
		context: MigrationContext,
		input: z.infer<typeof C.migrationJobInput>,
	): Promise<z.infer<typeof C.migrationExecuteOutput>>;
	cancel(
		context: MigrationContext,
		input: z.infer<typeof C.migrationJobInput>,
	): Promise<z.infer<typeof C.migrationCancelOutput>>;
	report(
		context: MigrationContext,
		input: z.input<typeof C.migrationReportInput>,
	): Promise<z.infer<typeof C.migrationReportOutput>>;
	exportReport(
		context: MigrationContext,
		input: z.infer<typeof C.migrationJobInput>,
	): Promise<z.infer<typeof C.migrationExportOutput>>;
	rollback(
		context: MigrationContext,
		input: z.infer<typeof C.migrationRollbackInput>,
	): Promise<z.infer<typeof C.migrationRollbackOutput>>;
	removeSource(
		context: MigrationContext,
		input: z.infer<typeof C.migrationSourceInput>,
	): Promise<z.infer<typeof C.migrationRemoveSourceOutput>>;
}
export function createMigrationApplication(options: {
	db: unknown;
	workspaceId: string;
	sourceStore?: unknown;
	clock?: () => Date;
	enabled?: boolean;
	executeEnabled?: boolean;
	backgroundEnabled?: boolean;
}): MigrationApplication;
export function createMigrationApplicationFromEnvironment(options: {
	db: unknown;
	workspaceId: string;
	environment?: Record<string, string | undefined>;
}): Promise<MigrationApplication>;
export function publicMigrationError(error: unknown): {
	status: number;
	message: string;
};
