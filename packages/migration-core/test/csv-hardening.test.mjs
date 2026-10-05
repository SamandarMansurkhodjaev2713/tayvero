import assert from "node:assert/strict";
import test from "node:test";
import {
	compileMapping,
	createMigrationDryRun,
	detectImportFormat,
	neutralizeSpreadsheetFormula,
	parseCsv,
} from "../src/index.mjs";

test("CSV: auto-detection works beyond the 30-row sampling boundary", () => {
	const csv =
		"name;email\n" +
		Array.from(
			{ length: 500 },
			(_, i) => `Contact ${i};c${i}@example.com`,
		).join("\n");
	const result = parseCsv(csv);
	assert.equal(result.delimiter, ";");
	assert.equal(result.rows.length, 500);
});
test("CSV: rejects text or a second quoted string after a closing quote", () => {
	for (const value of ['"Alice"suffix', '"Alice" "Bob"'])
		assert.throws(
			() => parseCsv(`name,email\n${value},a@example.com`, { delimiter: "," }),
			(e) => ["TRAILING_QUOTED_FIELD", "UNCLOSED_QUOTE"].includes(e.code),
		);
});
test("CSV: single-column imports are valid without explicit delimiter selection", () => {
	assert.deepEqual(parseCsv("Email\na@example.com\nb@example.com\n").rows, [
		["a@example.com"],
		["b@example.com"],
	]);
});
test("CSV: formula escaping includes line breaks and Unicode whitespace", () => {
	for (const value of ["\n=1+1", "\r\n@SUM(A1)", "\u00a0=1", "\uFEFF+1"])
		assert.equal(neutralizeSpreadsheetFormula(value), `'${value}`);
});
test("CSV: limits cannot be disabled by NaN or Infinity", () => {
	for (const key of [
		"maxRows",
		"maxColumns",
		"maxCharacters",
		"maxFieldCharacters",
	])
		assert.throws(
			() => parseCsv("a,b\nc,d", { [key]: Infinity }),
			(e) => e.code === "INVALID_CSV_LIMIT",
		);
});
test("CSV: source row numbers survive blank and multiline records", () => {
	const parsed = parseCsv(
		'name,email\n\n"Alice\nSmith",bad\nBob,b@example.com',
		{ delimiter: "," },
	);
	assert.deepEqual(parsed.rowNumbers, [3, 5]);
	const compiled = compileMapping({
		headers: parsed.headers,
		mapping: [{ source: "email", target: "email" }],
		targetSchema: { email: { type: "email", required: true } },
	});
	const plan = createMigrationDryRun({
		tenantId: "tenant",
		entityType: "contact",
		rows: parsed.rows,
		sourceRowNumbers: parsed.rowNumbers,
		compiledMapping: compiled,
	});
	assert.equal(plan.issues[0].rowNumber, 3);
	assert.equal(plan.batches[0].records[0].record.sourceRowNumber, 5);
});
test("CSV: format detection rejects backslash paths and control characters on every OS", () => {
	for (const filename of [
		"folder\\a.csv",
		"bad\nname.csv",
		"a".repeat(256) + ".csv",
	])
		assert.throws(
			() => detectImportFormat({ filename, bytes: new Uint8Array() }),
			(e) => e.code === "UNSAFE_FILENAME",
		);
});
