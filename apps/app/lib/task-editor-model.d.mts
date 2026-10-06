export function taskDeadlineInput(dueAt: string | null): string;
export function resolveTaskDeadline(
	value: string,
	original: string | null,
): string | null;
export function taskEditPatch(
	draft: { assigneeId: string | null; deadline: string },
	task: { assignee: { id: string } | null; dueAt: string | null },
): { assigneeId?: string | null; dueAt?: string | null };
export function taskCreationFields(draft: {
	deadline: string;
	assigneeId: string | null | undefined;
}): { dueAt: string | null; assigneeId?: string | null };
