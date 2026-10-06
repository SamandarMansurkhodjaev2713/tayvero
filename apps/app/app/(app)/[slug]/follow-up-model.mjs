export const FOLLOW_UP_LIMIT = 100;

function dayKey(date, formatter) {
	const parts = formatter.formatToParts(date);
	return ["year", "month", "day"]
		.map((type) => parts.find((part) => part.type === type)?.value)
		.join("-");
}

function deadlineClassifier(now, timeZone) {
	if (!Number.isFinite(now.getTime()))
		throw new RangeError("Invalid current date");
	const formatter = new Intl.DateTimeFormat("en-CA", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		...(timeZone ? { timeZone } : {}),
	});
	const today = dayKey(now, formatter);
	return (dueAt) => {
		if (!dueAt) return "undated";
		const due = new Date(dueAt);
		if (!Number.isFinite(due.getTime())) return "undated";
		const day = dayKey(due, formatter);
		return day < today ? "overdue" : day === today ? "today" : "upcoming";
	};
}

/** Calendar days, not elapsed 24-hour periods; timezone defaults to the browser. */
export function classifyFollowUpDeadline(dueAt, now, timeZone) {
	return deadlineClassifier(now, timeZone)(dueAt);
}

export function groupFollowUps(tasks, now, timeZone) {
	const classify = deadlineClassifier(now, timeZone);
	const groups = { overdue: [], today: [], undated: [], upcoming: [] };
	for (const task of tasks) {
		if (task.completedAt == null) groups[classify(task.dueAt)].push(task);
	}
	return groups;
}

/** A failed refresh with retained data is a stale snapshot, never an empty queue. */
export function followUpLoadState(data, isError, clockReady) {
	if (data === undefined) return isError ? "error" : "loading";
	if (!clockReady) return "loading";
	return isError ? "stale" : "ready";
}

/** Only remove a row after the server confirms completion of that same task. */
export function removeConfirmedFollowUp(tasks, result) {
	if (!tasks || !result.completedAt) return tasks;
	return tasks.filter((task) => task.id !== result.id);
}
