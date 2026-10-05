import assert from "node:assert/strict";
import test from "node:test";
import {
	compileMapping,
	createMigrationDryRun,
	detectImportFormat,
	MigrationDomainError,
	neutralizeSpreadsheetFormula,
	normalizeUzbekistanPhone,
	parseCsv,
	parseMoneyMinor,
	serializeCsv,
} from "../src/index.mjs";

function expectCode(fn, code) {
	assert.throws(
		fn,
		(error) => error instanceof MigrationDomainError && error.code === code,
	);
}

test("parses RFC4180 quoted commas, newlines, and escaped quotes", () => {
	const parsed = parseCsv(
		'name,email,note\r\n"Doe, Jane",jane@example.com,"said ""hello""\nnext"\r\n',
		{ delimiter: "," },
	);
	assert.deepEqual(parsed.headers, ["name", "email", "note"]);
	assert.deepEqual(parsed.rows[0], [
		"Doe, Jane",
		"jane@example.com",
		'said "hello"\nnext',
	]);
});
test("detects a semicolon delimiter", () =>
	assert.equal(
		parseCsv("name;email\nA;a@example.com\n", { delimiter: "auto" }).delimiter,
		";",
	));
test("removes UTF-8 BOM from the first header", () =>
	assert.equal(
		parseCsv("\ufeffname,email\nA,a@example.com\n", { delimiter: "," })
			.headers[0],
		"name",
	));
test("rejects an unclosed quote", () =>
	expectCode(
		() => parseCsv('name\n"open', { delimiter: "," }),
		"UNCLOSED_QUOTE",
	));
test("rejects duplicate normalized headers", () =>
	expectCode(
		() => parseCsv("Email,email\na,b\n", { delimiter: "," }),
		"DUPLICATE_HEADER",
	));
test("enforces row limits", () =>
	expectCode(
		() => parseCsv("h\na\nb\n", { delimiter: ",", maxRows: 2 }),
		"TOO_MANY_ROWS",
	));
test("neutralizes spreadsheet formulas in exported reports", () => {
	assert.equal(neutralizeSpreadsheetFormula("=1+1"), "'=1+1");
	assert.equal(neutralizeSpreadsheetFormula("  @SUM(A1)"), "'  @SUM(A1)");
	assert.equal(neutralizeSpreadsheetFormula("safe"), "safe");
});
test("serializes error reports with formula protection", () =>
	assert.match(
		serializeCsv({ headers: ["value"], rows: [["=cmd|' /C calc'!A0"]] }),
		/^value\r\n'=cmd/,
	));
test("parses money deterministically in minor units", () => {
	assert.equal(parseMoneyMinor("12.34", 2), "1234");
	assert.equal(parseMoneyMinor("-0.01", 2), "-1");
	expectCode(() => parseMoneyMinor("1.999", 2), "MONEY_PRECISION");
});
test("normalizes Uzbekistan phone numbers", () => {
	assert.equal(normalizeUzbekistanPhone("90 123 45 67"), "+998901234567");
	assert.equal(
		normalizeUzbekistanPhone("+998 (90) 123-45-67"),
		"+998901234567",
	);
});
test("validates extension, MIME, and XLSX ZIP signature", () => {
	assert.equal(
		detectImportFormat({
			filename: "contacts.csv",
			mimeType: "text/csv",
			bytes: new TextEncoder().encode("a,b"),
		}),
		"CSV",
	);
	assert.equal(
		detectImportFormat({
			filename: "contacts.xlsx",
			mimeType:
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
		}),
		"XLSX",
	);
	expectCode(
		() =>
			detectImportFormat({
				filename: "../contacts.csv",
				mimeType: "text/csv",
				bytes: new Uint8Array(),
			}),
		"UNSAFE_FILENAME",
	);
});

test("compiles deterministic mappings and validates required fields", () => {
	const compiled = compileMapping({
		headers: ["Email", "Phone"],
		mapping: [
			{ source: "Email", target: "email" },
			{ source: "Phone", target: "phone" },
		],
		targetSchema: {
			email: { type: "email", required: true },
			phone: { type: "phone_uz", required: false },
		},
	});
	assert.equal(compiled.entries.length, 2);
	expectCode(
		() =>
			compileMapping({
				headers: ["Email"],
				mapping: [],
				targetSchema: { email: { type: "email", required: true } },
			}),
		"MISSING_REQUIRED_MAPPING",
	);
});
test("creates deterministic dry-run batches and duplicate issues", () => {
	const compiled = compileMapping({
		headers: ["Email", "Phone"],
		mapping: [
			{ source: "Email", target: "email" },
			{ source: "Phone", target: "phone" },
		],
		targetSchema: {
			email: { type: "email", required: true },
			phone: { type: "phone_uz", required: false },
		},
	});
	const input = {
		tenantId: "tenant-a",
		entityType: "contact",
		compiledMapping: compiled,
		rows: [
			["A@Example.com", "901234567"],
			["a@example.com", "901234567"],
			["broken", ""],
		],
		batchSize: 1,
	};
	const first = createMigrationDryRun(input);
	const second = createMigrationDryRun(input);
	assert.equal(first.idempotencyKey, second.idempotencyKey);
	assert.equal(first.stats.validRows, 1);
	assert.equal(first.stats.errorRows, 2);
	assert.equal(first.stats.batches, 1);
	assert.ok(first.issues.some((issue) => issue.code === "DUPLICATE_IN_FILE"));
	assert.ok(first.issues.some((issue) => issue.code === "INVALID_EMAIL"));
});
test("marks existing-record matches as warnings without silently dropping the row", () => {
	const compiled = compileMapping({
		headers: ["Name"],
		mapping: [{ source: "Name", target: "name" }],
		targetSchema: { name: { type: "company_name", required: true } },
	});
	const result = createMigrationDryRun({
		tenantId: "tenant-a",
		entityType: "company",
		compiledMapping: compiled,
		rows: [["Acme LLC"]],
		existingDedupeKeys: ["company:name:acme llc"],
	});
	assert.equal(result.stats.validRows, 1);
	assert.equal(result.stats.warnings, 1);
});
