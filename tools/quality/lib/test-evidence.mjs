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

// Bun omits its skip/todo rows when there are none; its final test total is mandatory.
export function parseBunTestSummary(output) {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Bun CI may emit ANSI SGR color escapes.
	const text = String(output).replace(/\u001b\[[0-9;]*m/g, "");
	const total = [
		...text.matchAll(/^Ran (\d+) tests? across \d+ files?\./gm),
	].at(-1);
	const count = (key) => {
		const matches = [
			...text.matchAll(new RegExp(`^\\s*(\\d+) ${key}\\s*$`, "gm")),
		];
		return matches.length ? Number(matches.at(-1)[1]) : null;
	};
	return {
		tests: total ? Number(total[1]) : null,
		pass: count("pass"),
		fail: count("fail"),
		skipped: count("skip") ?? 0,
		cancelled: 0,
		todo: count("todo") ?? 0,
	};
}
