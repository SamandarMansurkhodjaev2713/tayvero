// Treat incomplete or skipped coverage as an unverified local release gate.
export function parseTestSummary(output) {
	return Object.fromEntries(
		["tests", "pass", "fail", "skipped", "cancelled", "todo"].map((key) => {
			const matches = [
				...String(output).matchAll(new RegExp(`^# ${key} (\\d+)\\r?$`, "gm")),
			];
			return [key, matches.length ? Number(matches.at(-1)[1]) : null];
		}),
	);
}

export function hasCompleteTestEvidence(summary) {
	return (
		Number.isSafeInteger(summary.tests) &&
		summary.tests > 0 &&
		summary.pass === summary.tests &&
		["fail", "skipped", "cancelled", "todo"].every((key) => summary[key] === 0)
	);
}
