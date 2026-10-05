import { createHash } from "node:crypto";
import { fail } from "./errors.mjs";
import { mapRow } from "./mapping.mjs";
import {
	normalizeCompanyName,
	normalizeEmail,
	normalizeUzbekistanPhone,
} from "./normalize.mjs";

function canonicalize(value) {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(canonicalize);
	const output = Object.create(null);
	for (const key of Object.keys(value).sort())
		output[key] = canonicalize(value[key]);
	return output;
}

function digest(value) {
	return createHash("sha256")
		.update(JSON.stringify(canonicalize(value)))
		.digest("hex");
}

function dedupeKey(entityType, record) {
	if (entityType === "contact") {
		if (record.email) return `contact:email:${normalizeEmail(record.email)}`;
		if (record.phone)
			return `contact:phone:${normalizeUzbekistanPhone(record.phone)}`;
	}
	if (entityType === "company" && record.name)
		return `company:name:${normalizeCompanyName(record.name).toLocaleLowerCase("en-US")}`;
	if (record.externalId)
		return `${entityType}:external:${String(record.externalId).trim()}`;
	return null;
}

export function createMigrationDryRun(input) {
	if (!["contact", "company", "deal"].includes(input.entityType))
		fail(
			"INVALID_ENTITY_TYPE",
			"Only contact, company and deal imports are supported",
		);
	if (typeof input.tenantId !== "string" || input.tenantId.trim() === "")
		fail("INVALID_TENANT", "tenantId is required");
	if (!Array.isArray(input.rows)) fail("INVALID_ROWS", "rows must be an array");
	const maxRows = input.maxRows ?? 100_000;
	const batchSize = input.batchSize ?? 500;
	if (
		!Number.isSafeInteger(maxRows) ||
		maxRows < 1 ||
		input.rows.length > maxRows
	)
		fail("ROW_LIMIT", "Dry run exceeds the row limit", { maxRows });
	if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 5_000)
		fail("BATCH_SIZE", "batchSize must be between 1 and 5000");
	const sourceRowNumbers =
		input.sourceRowNumbers ?? input.rows.map((_, index) => index + 2);
	if (
		!Array.isArray(sourceRowNumbers) ||
		sourceRowNumbers.length !== input.rows.length ||
		sourceRowNumbers.some(
			(number, index) =>
				!Number.isSafeInteger(number) ||
				number < 2 ||
				(index > 0 && number <= sourceRowNumbers[index - 1]),
		)
	)
		fail(
			"INVALID_SOURCE_ROW_NUMBERS",
			"Source row numbers must be ordered, distinct and aligned with data rows",
		);
	if (
		input.validateRecord !== undefined &&
		typeof input.validateRecord !== "function"
	)
		fail("INVALID_VALIDATOR", "Record validator must be a trusted function");
	const existingKeys = new Set(input.existingDedupeKeys ?? []);
	const seenKeys = new Map();
	const validRecords = [];
	const issues = [];
	for (let index = 0; index < input.rows.length; index += 1) {
		try {
			const mapped = mapRow(input.rows[index], input.compiledMapping);
			input.validateRecord?.(mapped);
			const key = dedupeKey(input.entityType, mapped);
			if (key && existingKeys.has(key)) {
				issues.push(
					Object.freeze({
						rowNumber: sourceRowNumbers[index],
						severity: "WARNING",
						code: "POSSIBLE_EXISTING_DUPLICATE",
						dedupeKey: key,
					}),
				);
			}
			if (key && seenKeys.has(key)) {
				issues.push(
					Object.freeze({
						rowNumber: sourceRowNumbers[index],
						severity: "ERROR",
						code: "DUPLICATE_IN_FILE",
						dedupeKey: key,
						firstRowNumber: seenKeys.get(key),
					}),
				);
				continue;
			}
			if (key) seenKeys.set(key, sourceRowNumbers[index]);
			const record = Object.freeze({
				...mapped,
				tenantId: input.tenantId,
				sourceRowNumber: sourceRowNumbers[index],
			});
			validRecords.push(
				Object.freeze({ record, fingerprint: digest(record), dedupeKey: key }),
			);
		} catch (error) {
			issues.push(
				Object.freeze({
					rowNumber: sourceRowNumbers[index],
					severity: "ERROR",
					code: error.code ?? "ROW_VALIDATION_FAILED",
					message: error.message,
				}),
			);
		}
	}
	const batches = [];
	for (let index = 0; index < validRecords.length; index += batchSize) {
		const records = validRecords.slice(index, index + batchSize);
		batches.push(
			Object.freeze({
				index: batches.length,
				count: records.length,
				digest: digest(records.map((item) => item.fingerprint)),
				records: Object.freeze(records),
			}),
		);
	}
	const stats = Object.freeze({
		sourceRows: input.rows.length,
		validRows: validRecords.length,
		errorRows: new Set(
			issues
				.filter((issue) => issue.severity === "ERROR")
				.map((issue) => issue.rowNumber),
		).size,
		warnings: issues.filter((issue) => issue.severity === "WARNING").length,
		batches: batches.length,
	});
	const planIdentity = Object.freeze({
		tenantId: input.tenantId,
		entityType: input.entityType,
		stats,
		recordFingerprints: validRecords.map((item) => item.fingerprint),
	});
	return Object.freeze({
		tenantId: input.tenantId,
		entityType: input.entityType,
		idempotencyKey: `migration:${digest(planIdentity)}`,
		stats,
		issues: Object.freeze(issues),
		batches: Object.freeze(batches),
		reconciliation: Object.freeze({
			sourceDigest: digest(input.rows),
			acceptedDigest: digest(validRecords.map((item) => item.fingerprint)),
			issueDigest: digest(issues),
		}),
	});
}
