import { WORKSPACE_ID } from "@crm/auth";
import type { Db } from "@crm/db";
import { InjectDatabase } from "../../database/database.constants";
import { requireDeploymentMembership, WorkspaceAccessError } from "../workspace-access.mjs";
import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
	MiddlewareOptions,
	MiddlewareResponse,
	TRPCMiddleware,
} from "nestjs-trpc";
import { setRequestUserId } from "../../logging/request-context";
import type { AuthedTrpcContext, BaseTrpcContext } from "../context.types";

@Injectable()
export class AuthMiddleware implements TRPCMiddleware {
	constructor(@InjectDatabase() private readonly db: Db) {}
	async use(opts: MiddlewareOptions): Promise<MiddlewareResponse> {
		const ctx = opts.ctx as BaseTrpcContext;
		const user = ctx.session?.user;

		if (!user) {
			throw new TRPCError({ code: "UNAUTHORIZED" });
		}

		try {
			await requireDeploymentMembership({ session: ctx.session, workspaceId: WORKSPACE_ID, findMembership: ({ workspaceId, userId }) => this.db.member.findUnique({ where: { organizationId_userId: { organizationId: workspaceId, userId } }, select: { role: true } }) });
		} catch (error) {
			if (error instanceof WorkspaceAccessError) throw new TRPCError({ code: error.code, message: error.message });
			throw error;
		}

		setRequestUserId(user.id);

		const nextCtx: AuthedTrpcContext = { ...ctx, user };
		return opts.next({ ctx: nextCtx });
	}
}
