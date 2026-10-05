const DAY = 86_400_000;
function ageDays(now, value) {
	if (!value) return null;
	const ms = now.getTime() - new Date(value).getTime();
	return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / DAY)) : null;
}
function addFactor(factors, code, impact, evidence) {
	if (impact > 0) factors.push({ code, impact, evidence });
}

export function calculateDealHealth(input) {
	const now =
		input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
	if (Number.isNaN(now.getTime())) throw new TypeError("now is invalid");
	const inactivityDays = ageDays(now, input.lastMeaningfulActivityAt);
	const stageDays = ageDays(now, input.stageEnteredAt);
	const inactivityTarget = Math.max(1, input.inactivityTargetDays ?? 5);
	const stageTarget = Math.max(1, input.stageTargetDays ?? 14);
	const factors = [];
	if (inactivityDays === null)
		addFactor(
			factors,
			"NO_MEANINGFUL_ACTIVITY",
			28,
			"No meaningful activity is recorded",
		);
	else if (inactivityDays > inactivityTarget)
		addFactor(
			factors,
			"INACTIVITY",
			Math.min(30, 8 + (inactivityDays - inactivityTarget) * 2),
			`${inactivityDays} days since meaningful activity`,
		);
	if (stageDays !== null && stageDays > stageTarget)
		addFactor(
			factors,
			"STAGE_AGING",
			Math.min(20, 5 + (stageDays - stageTarget)),
			`${stageDays} days in current stage`,
		);
	if (!input.hasNextStep)
		addFactor(factors, "NEXT_STEP_MISSING", 15, "No explicit next step");
	if (!input.hasDecisionMaker)
		addFactor(
			factors,
			"DECISION_MAKER_MISSING",
			12,
			"Decision maker is not confirmed",
		);
	if (!input.hasChampion)
		addFactor(
			factors,
			"CHAMPION_MISSING",
			6,
			"Internal champion is not confirmed",
		);
	const overdueTasks = Math.max(0, Number(input.overdueTaskCount ?? 0));
	addFactor(
		factors,
		"OVERDUE_TASKS",
		Math.min(15, overdueTasks * 3),
		`${overdueTasks} overdue task(s)`,
	);
	if (input.communicationTrend === "DECLINING")
		addFactor(
			factors,
			"DECLINING_ENGAGEMENT",
			10,
			"Communication engagement is declining",
		);
	const completenessBps = input.requiredFieldCompletenessBps ?? 10_000;
	if (
		!Number.isInteger(completenessBps) ||
		completenessBps < 0 ||
		completenessBps > 10_000
	)
		throw new RangeError("requiredFieldCompletenessBps must be 0..10000");
	if (completenessBps < 8_000)
		addFactor(
			factors,
			"INCOMPLETE_DATA",
			Math.ceil((8_000 - completenessBps) / 500),
			`Required-field completeness is ${(completenessBps / 100).toFixed(0)}%`,
		);
	const penalty = factors.reduce((sum, factor) => sum + factor.impact, 0);
	const score = Math.max(0, Math.min(100, 100 - penalty));
	const band = score >= 80 ? "HEALTHY" : score >= 55 ? "ATTENTION" : "AT_RISK";
	return {
		score,
		band,
		factors: factors.sort((a, b) => b.impact - a.impact),
		evidenceVersion: "deterministic-v1",
	};
}
