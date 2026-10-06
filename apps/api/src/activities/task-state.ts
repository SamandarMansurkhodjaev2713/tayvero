import type { WorkspaceRole } from "@crm/auth";

export interface TaskActor {
	id: string;
	name: string;
	role: WorkspaceRole;
}
export interface TaskState {
	assigneeId: string | null;
	assignee?: { name: string } | null;
	dueAt: Date | null;
	completedAt: Date | null;
}

export function taskState(state: TaskState) {
	return {
		assigneeId: state.assigneeId,
		assigneeName: state.assignee?.name ?? null,
		dueAt: state.dueAt?.toISOString() ?? null,
		completedAt: state.completedAt?.toISOString() ?? null,
	};
}

export function taskPermissions(
	task: { createdById: string; assigneeId: string | null },
	actor: TaskActor,
) {
	const canReassign =
		task.createdById === actor.id ||
		actor.role === "owner" ||
		actor.role === "admin";
	return { canReassign, canEdit: canReassign || task.assigneeId === actor.id };
}
