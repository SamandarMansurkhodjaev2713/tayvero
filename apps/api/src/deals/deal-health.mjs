/** Read-only attention signals from recorded CRM facts. This is not win probability or LLM inference. */
export const DEAL_HEALTH_RULESET = "recorded-deal-signals-v1";
const DAY = 86400000;
const OPEN = new Set([
	"DEMO_BOOKED",
	"QUALIFIED_TO_BUY",
	"DECISION_MAKER_BOUGHT_IN",
	"CONTRACT_SENT",
]);
const CLOSED = new Set(["CLOSED_WON", "CLOSED_LOST", "UNQUALIFIED_TO_BUY"]);
const NOT_EVALUATED = Object.freeze([
	"Messages outside this CRM",
	"Stakeholder sentiment",
	"Unrecorded commitments",
	"Probability of winning",
]);
function timestamp(value) {
	if (value instanceof Date)
		return Number.isFinite(value.getTime()) ? value.getTime() : null;
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value))
		return null;
	const result = Date.parse(value);
	return Number.isFinite(result) ? result : null;
}
function businessDay(now, timeZone) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date(now));
	const get = (type) => parts.find((part) => part.type === type).value;
	return `${get("year")}-${get("month")}-${get("day")}`;
}
/** `source` must come from the authorized server query, never directly from a browser/model. */
export function evaluateDealHealth(
	source,
	{ now = new Date(), timeZone = "Asia/Tashkent" } = {},
) {
	const at = timestamp(now);
	if (at === null) throw new TypeError("A valid observation clock is required");
	if (!source || typeof source.id !== "string" || !source.id)
		throw new TypeError("A recorded deal ID is required");
	const today = businessDay(at, timeZone);
	const snapshot = {
		ruleset: DEAL_HEALTH_RULESET,
		checkedAt: new Date(at).toISOString(),
		timeZone,
		status: "CLEAR",
		attentionScore: null,
		signals: [],
		unknown: [],
		notEvaluated: [...NOT_EVALUATED],
	};
	if (source.archivedAt || CLOSED.has(source.stage))
		return { ...snapshot, status: "NOT_APPLICABLE" };
	if (!OPEN.has(source.stage))
		return {
			...snapshot,
			status: "INSUFFICIENT_DATA",
			unknown: ["The current stage has no known open/closed semantics."],
		};
	function add(
		id,
		weight,
		title,
		explanation,
		field,
		value,
		recommendation,
		recordId = source.id,
		model = "Deal",
	) {
		snapshot.signals.push({
			id,
			weight,
			title,
			explanation,
			recommendation,
			evidence: {
				model,
				recordId,
				field,
				value: value == null ? null : String(value),
				checkedAt: snapshot.checkedAt,
			},
		});
	}
	function factDate(value, label) {
		const time = timestamp(value);
		if (time === null || time > at) {
			snapshot.unknown.push(`${label} is missing, invalid or in the future.`);
			return null;
		}
		return time;
	}
	const created = factDate(source.createdAt, "Created timestamp");
	const stageSince = factDate(source.stageChangedAt, "Stage timestamp");
	if (created !== null && stageSince !== null && stageSince < created)
		snapshot.unknown.push("Stage timestamp precedes creation.");
	if (stageSince !== null) {
		const age = Math.floor((at - stageSince) / DAY);
		if (age >= 14)
			add(
				"STAGE_AGING",
				age >= 28 ? 30 : 15,
				"Long time in this stage",
				`${age} complete days in the current stage; the review threshold is 14 days.`,
				"stageChangedAt",
				new Date(stageSince).toISOString(),
				"Review the next stage or record why the deal needs more time.",
			);
	}
	if (source.lastActivityAt == null) {
		if (created !== null && at - created >= 7 * DAY)
			add(
				"NO_RECORDED_ACTIVITY",
				15,
				"No activity recorded",
				"No CRM activity timestamp is present after at least 7 days. This does not prove that no conversations happened.",
				"lastActivityAt",
				null,
				"Record the latest customer conversation or check channel synchronization.",
			);
	} else {
		const active = factDate(source.lastActivityAt, "Activity timestamp");
		if (active !== null) {
			if (created !== null && active < created)
				snapshot.unknown.push("Activity timestamp precedes creation.");
			const age = Math.floor((at - active) / DAY);
			if (age >= 7)
				add(
					"INACTIVE",
					age >= 14 ? 25 : 15,
					"Recent activity needs review",
					`${age} complete days since the last recorded CRM activity.`,
					"lastActivityAt",
					new Date(active).toISOString(),
					"Check the timeline and agree on a next contact.",
				);
		}
	}
	if (source.expectedCloseDate != null) {
		const close = timestamp(source.expectedCloseDate);
		if (close === null)
			snapshot.unknown.push("Expected close date is invalid.");
		else {
			// This field is a business date encoded at UTC midnight, not an appointment instant.
			const due = new Date(close).toISOString().slice(0, 10);
			if (due < today)
				add(
					"CLOSE_OVERDUE",
					20,
					"Expected close date has passed",
					`Recorded close date ${due} is before ${today} in ${timeZone}.`,
					"expectedCloseDate",
					due,
					"Confirm the decision date or update the expected close date.",
				);
		}
	}
	const taskCount = source.pendingTaskCount;
	if (!Number.isSafeInteger(taskCount) || taskCount < 0)
		snapshot.unknown.push("Pending-task coverage is unavailable.");
	else if (taskCount === 0)
		add(
			"NO_NEXT_STEP",
			15,
			"No open next step",
			"No incomplete TASK activity is linked to this deal.",
			"pendingTaskCount",
			0,
			"Add a dated task in Activity after confirming the next step.",
		);
	else if (!source.nextTask || typeof source.nextTask.id !== "string")
		snapshot.unknown.push("The next-task record is missing.");
	else if (source.nextTask.dueAt == null)
		add(
			"UNDATED_NEXT_STEP",
			10,
			"Next step needs a date",
			"Open tasks exist, but none has a due date.",
			"dueAt",
			null,
			"Give the next task an agreed due date.",
			source.nextTask.id,
			"Activity",
		);
	else {
		const due = timestamp(source.nextTask.dueAt);
		if (due === null)
			snapshot.unknown.push("The next-task due date is invalid.");
		else if (due < at)
			add(
				"TASK_OVERDUE",
				25,
				"An open task is overdue",
				"The earliest incomplete task is past its recorded due time.",
				"dueAt",
				new Date(due).toISOString(),
				"Review the task before completing or rescheduling it.",
				source.nextTask.id,
				"Activity",
			);
	}
	if (Number.isSafeInteger(source.contactCount) && source.contactCount >= 0) {
		if (source.contactCount === 0)
			add(
				"NO_LINKED_CONTACT",
				5,
				"No contact linked",
				"This deal has no linked contacts. This does not identify which stakeholders are missing.",
				"contactCount",
				0,
				"Link the customer contact you are working with.",
			);
	} else snapshot.unknown.push("Linked-contact coverage is unavailable.");
	snapshot.signals.sort(
		(a, b) => b.weight - a.weight || a.id.localeCompare(b.id, "en"),
	);
	snapshot.status = snapshot.unknown.length
		? "INSUFFICIENT_DATA"
		: snapshot.signals.length
			? "NEEDS_ATTENTION"
			: "CLEAR";
	if (!snapshot.unknown.length)
		snapshot.attentionScore = Math.min(
			100,
			snapshot.signals.reduce((sum, signal) => sum + signal.weight, 0),
		);
	return snapshot;
}
