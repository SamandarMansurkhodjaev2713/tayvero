/** Current deployment model is one CRM dataset per database, not shared multi-tenant CRM. */
export class WorkspaceAccessError extends Error {
	constructor(code, message) {
		super(message);
		this.name = "WorkspaceAccessError";
		this.code = code;
	}
}
function deny(code, message) {
	throw new WorkspaceAccessError(code, message);
}
export async function requireDeploymentMembership({
	session,
	workspaceId,
	findMembership,
	now = Date.now(),
}) {
	if (
		typeof workspaceId !== "string" ||
		!workspaceId ||
		typeof findMembership !== "function"
	)
		deny("INTERNAL_SERVER_ERROR", "Workspace access is not configured.");
	const userId = session?.user?.id;
	const authSession = session?.session;
	if (
		typeof userId !== "string" ||
		!userId ||
		!authSession ||
		authSession.userId !== userId
	)
		deny("UNAUTHORIZED", "A valid signed-in session is required.");
	const rawExpiry = authSession.expiresAt;
	const expiresAt =
		rawExpiry instanceof Date
			? rawExpiry.getTime()
			: typeof rawExpiry === "string" || typeof rawExpiry === "number"
				? new Date(rawExpiry).getTime()
				: NaN;
	if (!Number.isFinite(expiresAt) || !Number.isFinite(now) || expiresAt <= now)
		deny("UNAUTHORIZED", "The session has expired.");
	// API-key sessions may have no active organization; they still require current deployment membership.
	const active = authSession.activeOrganizationId;
	if (active !== undefined && active !== null && active !== workspaceId)
		deny("FORBIDDEN", "This session belongs to another workspace.");
	const membership = await findMembership({ workspaceId, userId });
	if (!membership || !["owner", "admin", "member"].includes(membership.role))
		deny("FORBIDDEN", "You are not an active member of this workspace.");
	return Object.freeze({ workspaceId, userId, role: membership.role });
}
