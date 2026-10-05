import assert from "node:assert/strict";
import test from "node:test";
import {
	canRunMigration,
	mappingEntries,
	progressOf,
	validateMappingSelection,
} from "../app/(app)/[slug]/settings/migrations/migration-view-model.mjs";
import {
	OPERATIONS_CATALOG,
	operationsLocale,
} from "../lib/operations-catalog.mjs";

test("operation language catalogs contain the same complete set of nonempty keys", () => {
	const expected = Object.keys(OPERATIONS_CATALOG.en).sort();
	for (const locale of ["ru", "uz"]) {
		assert.deepEqual(Object.keys(OPERATIONS_CATALOG[locale]).sort(), expected);
		assert.ok(
			Object.values(OPERATIONS_CATALOG[locale]).every(
				(v) => typeof v === "string" && v.trim(),
			),
		);
	}
	assert.equal(operationsLocale("unsupported"), "en");
});
test("display never treats missing counts as completed work", () => {
	assert.equal(progressOf(undefined).percent, 0);
	assert.equal(
		progressOf({ totalRows: 10, created: 2, duplicates: 1, rejected: 0 })
			.percent,
		30,
	);
	assert.equal(
		progressOf({ totalRows: 10, created: NaN, duplicates: 0, rejected: 0 })
			.percent,
		0,
	);
});
test("UI execution respects server capability and terminal state", () => {
	assert.equal(
		canRunMigration({
			configured: true,
			executionEnabled: false,
			status: "READY",
		}),
		false,
	);
	assert.equal(
		canRunMigration({
			configured: true,
			executionEnabled: true,
			status: "COMPLETED",
		}),
		false,
	);
	assert.equal(
		canRunMigration({
			configured: true,
			executionEnabled: true,
			status: "READY",
		}),
		true,
	);
});
test("required mapping cannot be omitted and skipped columns are not sent", () => {
	const schema = [
		{ key: "firstName", required: true },
		{ key: "email", required: false },
	];
	assert.equal(validateMappingSelection(schema, { email: "Email" }), false);
	assert.equal(
		validateMappingSelection(schema, { firstName: "Name", tenantId: "Tenant" }),
		false,
	);
	assert.deepEqual(mappingEntries({ firstName: "Name", email: "" }), [
		{ source: "Name", target: "firstName" },
	]);
});
