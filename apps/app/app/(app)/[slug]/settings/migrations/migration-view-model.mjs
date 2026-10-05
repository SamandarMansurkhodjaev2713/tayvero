export function mappingEntries(fields) {
	return Object.entries(fields)
		.filter(([, source]) => source)
		.map(([target, source]) => ({ source, target }));
}
export function canRunMigration({
	configured,
	executionEnabled,
	status,
	running,
}) {
	return (
		configured === true &&
		executionEnabled === true &&
		!running &&
		["READY", "IMPORTING"].includes(status)
	);
}
export function progressOf(report) {
	if (
		!report ||
		!Number.isSafeInteger(report.totalRows) ||
		report.totalRows < 0
	)
		return { processed: 0, total: 0, percent: 0 };
	const values = [report.created, report.duplicates, report.rejected];
	if (values.some((value) => !Number.isSafeInteger(value) || value < 0))
		return { processed: 0, total: report.totalRows, percent: 0 };
	const processed = Math.min(
		report.totalRows,
		values.reduce((a, b) => a + b, 0),
	);
	return {
		processed,
		total: report.totalRows,
		percent:
			report.totalRows === 0
				? 0
				: Math.round((processed / report.totalRows) * 100),
	};
}
export function validateMappingSelection(schema, selection) {
	if (!Array.isArray(schema)) return false;
	const keys = new Set(schema.map((field) => field.key));
	if (Object.keys(selection).some((key) => !keys.has(key))) return false;
	return schema.every(
		(field) =>
			!field.required ||
			(typeof selection[field.key] === "string" &&
				selection[field.key].length > 0),
	);
}
