import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
const entity = z.enum(["contact", "company"]);
const source = z.object({
	id,
	filename: z.string(),
	sha256: sha,
	byteLength: count,
	format: z.string(),
	createdAt: z.string(),
	mimeType: z.string().optional(),
	deleted: z.boolean().optional(),
	purged: z.boolean().optional(),
});
const issue = z.object({
	rowNumber: count,
	severity: z.enum(["ERROR", "WARNING"]),
	code: z.string(),
});
const stats = z.object({
	sourceRows: count,
	validRows: count,
	errorRows: count,
	warnings: count,
	batches: count,
});
export const migrationEmptyInput = z.object({}).strict();
export const migrationCapabilitiesOutput = z.object({
	configured: z.boolean(),
	executionEnabled: z.boolean(),
	backgroundEnabled: z.boolean(),
	maxBytes: count,
	maxRows: count,
	formats: z.array(z.string()),
	entityTypes: z.array(z.string()),
	fields: z.record(
		z.string(),
		z.array(z.object({ key: z.string(), required: z.boolean() })),
	),
	policy: z.string(),
	dedicatedWorkspace: z.boolean(),
});
export const migrationListOutput = z.object({
	sources: z.array(source),
	jobs: z.array(
		z.object({
			id,
			sourceFilename: z.string(),
			entityType: z.string(),
			status: z.string(),
			totalRows: count,
			acceptedRows: count,
			rejectedRows: count,
			createdAt: z.string(),
			backgroundEnabled: z.boolean(),
			backgroundLastErrorCode: z.string().nullable(),
			backgroundNextAttemptAt: z.string().nullable(),
		}),
	),
	limit: count,
});
export const migrationUploadInput = z
	.object({
		filename: z.string().min(1).max(255),
		mimeType: z.enum([
			"text/csv",
			"text/tab-separated-values",
			"application/octet-stream",
			"text/plain",
			"application/vnd.ms-excel",
		]),
		base64: z.string().min(1).max(699052),
	})
	.strict();
export const migrationSourceInput = z
	.object({ sourceId: id, expectedSha256: sha })
	.strict();
export const migrationPreviewOutput = z.object({
	source,
	preview: z.object({
		headers: z.array(z.string()),
		rows: z.array(z.array(z.string())),
		rowNumbers: z.array(count),
		totalRows: count,
		delimiter: z.string(),
		encoding: z.string(),
	}),
});
export const migrationPrepareInput = z
	.object({
		sourceId: id,
		expectedSha256: sha,
		entityType: entity,
		mapping: z
			.array(
				z
					.object({ source: z.string().max(1000), target: z.string().max(128) })
					.strict(),
			)
			.max(10),
		commandId: id,
	})
	.strict();
export const migrationPrepareOutput = z.object({
	jobId: id,
	status: z.string(),
	stats,
	issues: z.array(issue),
	issueCount: count,
	ownerId: id,
	planIdentity: z.string(),
	existingDatabaseDedupe: z.string(),
	writesPerformed: z.literal(false),
});
export const migrationJobInput = z.object({ jobId: id }).strict();
export const migrationExecuteOutput = z.object({
	jobId: id,
	status: z.string(),
	done: z.boolean(),
	busy: z.boolean(),
});
export const migrationCancelOutput = z.object({
	jobId: id,
	status: z.string(),
});
export const migrationReportInput = z
	.object({ jobId: id, afterRow: count.max(5000000).default(0) })
	.strict();
export const migrationReportOutput = z.object({
	jobId: id,
	background: z.object({
		enabled: z.boolean(),
		lastErrorCode: z.string().nullable(),
		nextAttemptAt: z.string().nullable(),
	}),
	sourceFilename: z.string(),
	entityType: z.string(),
	status: z.string(),
	totalRows: count,
	created: count,
	duplicates: count,
	rejected: count,
	rolledBack: count,
	remaining: count,
	reconciliation: z.object({
		ok: z.boolean(),
		countersAgree: z.boolean(),
		explanation: z.string(),
	}),
	rows: z.array(
		z.object({
			rowNumber: count,
			status: z.string(),
			code: z.string(),
			entityId: z.string().nullable(),
			issues: z.array(issue),
		}),
	),
	nextAfterRow: count.nullable(),
});
export const migrationRollbackInput = z
	.object({
		jobId: id,
		afterRow: count.default(0),
		apply: z.boolean().default(false),
		confirmation: id.optional(),
	})
	.strict();
export const migrationRollbackOutput = z.object({
	rows: z.array(z.object({ rowNumber: count, result: z.string() })),
	nextAfterRow: count.nullable(),
	destructiveDelete: z.literal(false),
});
export const migrationRemoveSourceOutput = z.object({
	sourceId: id,
	deleted: z.literal(true),
});
export const migrationExportOutput = z.object({
	filename: z.string().max(200),
	mimeType: z.literal("text/csv;charset=utf-8"),
	content: z.string().max(2097152),
	rowCount: count.max(5000),
	remaining: count,
	reconciled: z.boolean(),
	exportedAt: z.string(),
});
export const migrationBackgroundInput = z
	.object({ jobId: id, enabled: z.boolean(), confirmation: id.optional() })
	.strict();
export const migrationBackgroundOutput = z.object({
	jobId: id,
	enabled: z.boolean(),
	version: count,
});
export const migrationCleanupInput = z
	.object({
		cutoff: z.string().datetime().optional(),
		apply: z.boolean().default(false),
		expectedPlanHash: sha.optional(),
	})
	.strict();
export const migrationCleanupOutput = z.object({
	cutoff: z.string(),
	planHash: sha,
	applied: z.boolean(),
	protectedCount: count,
	truncated: z.boolean(),
	scannedFiles: count,
	ignoredFiles: count,
	warnings: z.array(z.string()),
	unusedRetentionDays: count,
	orphanGraceDays: count,
	candidates: z
		.array(
			z.object({
				sourceId: id,
				sha256: sha,
				kind: z.enum(["PENDING_PURGE", "UNUSED_EXPIRED", "ORPHAN"]),
			}),
		)
		.max(25),
	results: z
		.array(
			z.object({
				sourceId: id,
				status: z.enum(["PURGED", "REVIEW_REQUIRED"]),
				code: z.string().optional(),
			}),
		)
		.max(25),
});
