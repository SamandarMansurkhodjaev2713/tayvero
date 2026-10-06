/** Native datetime-local values represent the viewer's local calendar, not UTC. */
export function taskDeadlineInput(dueAt) {
	if (!dueAt) return "";
	const date = new Date(dueAt);
	if (!Number.isFinite(date.getTime())) return "";
	const pad = (value) => String(value).padStart(2, "0");
	return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Preserve the original instant (and seconds) when the displayed minute is unchanged. */
export function resolveTaskDeadline(value, original) {
	if (!value) return null;
	if (original && value === taskDeadlineInput(original)) return original;
	const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
	if (!parts)
		throw new Error(
			"Enter a valid local date and time, or clear the due date.",
		);
	const [year, month, day, hour, minute] = parts.slice(1).map(Number);
	const date = new Date(0);
	date.setFullYear(year, month - 1, day);
	date.setHours(hour, minute, 0, 0);
	if (
		year < 1 ||
		date.getFullYear() !== year ||
		date.getMonth() !== month - 1 ||
		date.getDate() !== day ||
		date.getHours() !== hour ||
		date.getMinutes() !== minute
	)
		throw new Error(
			"That local time does not exist or the date is invalid. Choose another time.",
		);
	return date.toISOString();
}

export function taskEditPatch({ assigneeId, deadline }, task) {
	const patch = {};
	if (assigneeId !== task.assignee?.id) {
		if (!(assigneeId === null && task.assignee === null))
			patch.assigneeId = assigneeId;
	}
	const dueAt = resolveTaskDeadline(deadline, task.dueAt);
	if (dueAt !== task.dueAt) patch.dueAt = dueAt;
	return patch;
}

/** Omission delegates responsibility to the server's current actor; null means unassigned. */
export function taskCreationFields({ deadline, assigneeId }) {
	return {
		dueAt: resolveTaskDeadline(deadline, null),
		...(assigneeId === undefined ? {} : { assigneeId }),
	};
}
