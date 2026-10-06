import { randomUUID } from "node:crypto";
import { auth, WORKSPACE_ID, type WorkspaceRole } from "@crm/auth";
import { db } from "@crm/db";
import { resolveTestDatabase } from "@crm/db/test-database";
import { createAuthMiddleware } from "better-auth/api";
import { applySetCookies } from "better-auth/cookies";

export interface SignedSessionFixture {
	user: { id: string; name: string; email: string };
	cookie: string;
	revoke: () => Promise<void>;
	cleanup: () => Promise<void>;
}

/** Test-only real auth session. Never logs its token or replaces production guards. */
export async function signedSessionFixture(
	role: WorkspaceRole,
	expiresAt = new Date(Date.now() + 60 * 60 * 1000),
	beforeSession?: () => void,
): Promise<SignedSessionFixture> {
	if (process.env.NODE_ENV !== "test")
		throw new Error("Signed fixtures require NODE_ENV=test.");
	resolveTestDatabase(process.env);
	const id = `http-role-${randomUUID()}`;
	const user = await db.user.create({
		data: { id, name: role, email: `${id}@example.test`, emailVerified: true },
	});
	try {
		await db.member.create({
			data: {
				id: `${id}-member`,
				organizationId: WORKSPACE_ID,
				userId: id,
				role,
				createdAt: new Date(),
			},
		});
		const token = randomUUID();
		// Test-only fault injection checks cleanup after membership persistence.
		beforeSession?.();
		await db.session.create({
			data: {
				id: `${id}-session`,
				token,
				userId: id,
				activeOrganizationId: WORKSPACE_ID,
				expiresAt,
			},
		});
		const context = await auth.$context;
		const definition = context.authCookies.sessionToken;
		const serialize = createAuthMiddleware(async (ctx) =>
			ctx.setSignedCookie(
				definition.name,
				token,
				context.secret,
				definition.attributes,
			),
		);
		const headers = new Headers();
		applySetCookies(headers, [await serialize({ headers: new Headers() })]);
		const cookie = headers.get("cookie");
		if (!cookie)
			throw new Error("Auth did not produce a signed fixture cookie.");
		return {
			user,
			cookie,
			revoke: async () => {
				await db.member.deleteMany({
					where: { userId: id, organizationId: WORKSPACE_ID },
				});
			},
			cleanup: async () => {
				await db.user.delete({ where: { id } });
			},
		};
	} catch (error) {
		try {
			await db.user.delete({ where: { id } });
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				"Signed fixture creation and cleanup failed.",
			);
		}
		throw error;
	}
}
