import { WORKSPACE_ID } from "@crm/auth";
import type { Db } from "@crm/db";
import { HttpException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { z } from "zod";
import { InjectDatabase } from "../database/database.constants";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { requireDeploymentMembership } from "../trpc/workspace-access.mjs";
import { createMigrationApplicationFromEnvironment, publicMigrationError, type MigrationApplication } from "./migration-application.mjs";
import type * as C from "./migrations.contracts";
@Injectable()
export class MigrationsService {
    private applicationPromise?: Promise<MigrationApplication>;
    constructor(
    @InjectDatabase()
    private readonly db: Db) { }
    private application() {
        if (!this.applicationPromise) {
            this.applicationPromise = createMigrationApplicationFromEnvironment({ db: this.db, workspaceId: WORKSPACE_ID });
            this.applicationPromise.catch(() => { this.applicationPromise = undefined; });
        }
        return this.applicationPromise;
    }
    private async call<T>(ctx: AuthedTrpcContext, operation: (app: MigrationApplication, context: {
        tenantId: string;
        actorId: string;
    }) => Promise<T>): Promise<T> {
        if (!ctx.user || ctx.user.id !== ctx.session?.user.id)
            throw new UnauthorizedException("A signed-in session is required.");
        const membership = await requireDeploymentMembership({ session: ctx.session, workspaceId: WORKSPACE_ID, findMembership: ({ workspaceId, userId }) => this.db.member.findUnique({ where: { organizationId_userId: { organizationId: workspaceId, userId } }, select: { role: true } }) });
        try {
            return await operation(await this.application(), { tenantId: membership.workspaceId, actorId: membership.userId });
        }
        catch (error) {
            const safe = publicMigrationError(error);
            throw new HttpException(safe.message, safe.status);
        }
    }
    capabilities(ctx: AuthedTrpcContext) { return this.call(ctx, (app, context) => app.capabilities(context)); }
    list(ctx: AuthedTrpcContext) { return this.call(ctx, (app, context) => app.list(context)); }
    upload(ctx: AuthedTrpcContext, input: z.infer<typeof C.migrationUploadInput>) { return this.call(ctx, (app, context) => app.upload(context, input)); }
    preview(ctx: AuthedTrpcContext, input: z.infer<typeof C.migrationSourceInput>) { return this.call(ctx, (app, context) => app.preview(context, input)); }
    prepare(ctx: AuthedTrpcContext, input: z.infer<typeof C.migrationPrepareInput>) { return this.call(ctx, (app, context) => app.prepare(context, input)); }
    executeNext(ctx: AuthedTrpcContext, input: z.infer<typeof C.migrationJobInput>) { return this.call(ctx, (app, context) => app.executeNext(context, input)); }
    cancel(ctx: AuthedTrpcContext, input: z.infer<typeof C.migrationJobInput>) { return this.call(ctx, (app, context) => app.cancel(context, input)); }
    report(ctx: AuthedTrpcContext, input: z.infer<typeof C.migrationReportInput>) { return this.call(ctx, (app, context) => app.report(context, input)); }
    exportReport(ctx: AuthedTrpcContext, input: z.infer<typeof C.migrationJobInput>) { return this.call(ctx, (app, context) => app.exportReport(context, input)); }
    rollback(ctx: AuthedTrpcContext, input: z.infer<typeof C.migrationRollbackInput>) { return this.call(ctx, (app, context) => app.rollback(context, input)); }
    removeSource(ctx: AuthedTrpcContext, input: z.infer<typeof C.migrationSourceInput>) { return this.call(ctx, (app, context) => app.removeSource(context, input)); }
    cleanupSources(ctx: AuthedTrpcContext, input: z.infer<typeof C.migrationCleanupInput>) { return this.call(ctx, (app, c) => app.cleanupSources(c, input)); }
    setBackground(ctx: AuthedTrpcContext, input: z.infer<typeof C.migrationBackgroundInput>) { return this.call(ctx, (app, c) => app.setBackground(c, input)); }
}
