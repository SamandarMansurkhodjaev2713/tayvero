export class WorkspaceAccessError extends Error {
	code: "UNAUTHORIZED" | "FORBIDDEN" | "INTERNAL_SERVER_ERROR";
}
export function requireDeploymentMembership(input: {
	session: unknown;
	workspaceId: string;
	now?: number;
	findMembership: (input: { workspaceId: string; userId: string }) => Promise<{
		role: string;
	} | null>;
}): Promise<
	Readonly<{
		workspaceId: string;
		userId: string;
		role: "owner" | "admin" | "member";
	}>
>;
