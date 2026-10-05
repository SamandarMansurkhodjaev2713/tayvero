import { createHash, randomUUID } from "node:crypto";
import { serializeCsv } from "@crm/migration-core";
import {
	createEncryptedFileSourceStore,
	createMigrationCoordinator,
	createMigrationSourcePreparation,
	createPrismaMigrationRepository,
} from "@crm/migration-runtime";
import {
	assertBackgroundClaim,
	createBackgroundImport,
} from "./background-import.mjs";
import { createSourceLifecycle } from "./source-lifecycle.mjs";
export class MigrationApplicationError extends Error {
	constructor(code, message) {
		super(message);
		this.name = "MigrationApplicationError";
		this.code = code;
		this.retryable = ["STALE_JOB", "ROLLBACK_CONFLICT"].includes(code);
	}
}
const fail = (code, message) => {
	throw new MigrationApplicationError(code, message);
};
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const SHA = /^[a-f0-9]{64}$/;
const MAX_BYTES = 512 * 1024;
const MAX_ROWS = 5000;
const BATCH_SIZE = 50;
const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const SCHEMAS = Object.freeze({
	contact: Object.freeze({
		firstName: { type: "string", required: true },
		lastName: { type: "string" },
		email: { type: "email" },
		phone: { type: "phone_uz" },
		title: { type: "string" },
	}),
	company: Object.freeze({
		name: { type: "company_name", required: true },
		domain: { type: "string" },
		email: { type: "email" },
		phone: { type: "phone_uz" },
	}),
});
const hash = (value) =>
	createHash("sha256")
		.update(typeof value === "string" ? value : JSON.stringify(value))
		.digest("hex");
function identifier(value) {
	if (typeof value !== "string" || !ID.test(value))
		fail("INVALID_INPUT", "Invalid identifier");
	return value;
}
function digest(value) {
	if (typeof value !== "string" || !SHA.test(value))
		fail("INVALID_INPUT", "A source SHA-256 is required");
	return value;
}
function metadata(row) {
	return {
		id: row.id,
		filename: row.filename,
		sha256: row.sha256,
		byteLength: row.byteLength,
		format: row.format,
		createdAt: new Date(row.createdAt).toISOString(),
		deleted: row.deletedAt != null,
		purged: row.purgedAt != null,
	};
}
function issue(value) {
	return {
		rowNumber: value.rowNumber,
		severity: value.severity,
		code: /^[A-Z_0-9]{1,80}$/.test(value.code)
			? value.code
			: "ROW_VALIDATION_FAILED",
	};
}
function fields(record, entityType) {
	const result = {};
	for (const key of Object.keys(SCHEMAS[entityType])) {
		const value = record[key];
		if (
			value != null &&
			(typeof value !== "string" ||
				value.length > 300 ||
				// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject or sanitize control characters at this security boundary.
				/[\u0000-\u001f\u007f]/.test(value))
		)
			fail("INVALID_ROW", "Field length or control characters are invalid");
		if (value != null) result[key] = value;
	}
	if (entityType === "contact" && !result.email && !result.phone)
		fail(
			"IDENTITY_REQUIRED",
			"A contact needs an email or an Uzbekistan phone number for safe import",
		);
	if (result.domain) {
		const domain = result.domain.toLowerCase();
		if (
			domain.length > 253 ||
			!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
		)
			fail("INVALID_DOMAIN", "Use a plain domain, without protocol or path");
		result.domain = domain;
	}
	return result;
}
function createMigrationScope({
	db,
	workspaceId,
	clock,
	enabled,
	executeEnabled,
	prep,
}) {
	function time() {
		const date = clock();
		if (!(date instanceof Date) || !Number.isFinite(date.getTime()))
			fail("INVALID_CLOCK", "Invalid application clock");
		return date;
	}
	function context(value) {
		if (!value || value.tenantId !== workspaceId)
			fail(
				"FORBIDDEN",
				"This import service is scoped to its configured dedicated workspace",
			);
		return {
			tenantId: identifier(value.tenantId),
			actorId: identifier(value.actorId),
		};
	}
	async function authorize(client, c) {
		const member = await client.member.findFirst({
			where: { organizationId: c.tenantId, userId: c.actorId },
			select: { role: true },
		});
		if (!member || !["owner", "admin"].includes(member.role))
			fail(
				"FORBIDDEN",
				"Only a current workspace owner or admin can manage imports",
			);
	}
	function configured(write = false) {
		if (!enabled || !prep)
			fail(
				"NOT_CONFIGURED",
				"Migration Center is not configured by the deployment administrator",
			);
		if (write && !executeEnabled)
			fail(
				"EXECUTION_DISABLED",
				"CRM writes are disabled until the migration database acceptance gate passes",
			);
	}
	async function tx(c, callback) {
		// Only database operations belong inside retriable transactions. Source I/O is outside.
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				return await db.$transaction(
					async (client) => {
						await authorize(client, c);
						return callback(client);
					},
					{ isolationLevel: "Serializable", maxWait: 5000, timeout: 15000 },
				);
			} catch (error) {
				if (
					!["P2034", "P2002", "TRANSACTION_RETRY_EXHAUSTED"].includes(
						error?.code,
					) ||
					attempt === 2
				)
					throw error;
			}
		}
	}
	async function source(client, c, id, includeDeleted = false) {
		const row = await client.crmMigrationSource.findFirst({
			where: {
				id: identifier(id),
				workspaceId: c.tenantId,
				...(includeDeleted ? {} : { deletedAt: null }),
			},
		});
		if (!row) fail("NOT_FOUND", "Source not found");
		return row;
	}
	async function job(client, c, id) {
		const row = await client.crmMigrationJob.findFirst({
			where: { id: identifier(id), workspaceId: c.tenantId },
		});
		if (!row) fail("NOT_FOUND", "Import job not found");
		if (!row.sourceId || row.mapping?.applicationVersion !== 1)
			fail(
				"LEGACY_JOB",
				"This job predates Migration Center and remains operator-managed",
			);
		return row;
	}
	async function event(client, c, jobId, type, details = {}) {
		await client.crmMigrationEvent.create({
			data: {
				workspaceId: c.tenantId,
				jobId,
				type,
				actorId: c.actorId,
				details,
				createdAt: time(),
			},
		});
	}
	async function plan(c, sourceRow, entityType, mapping) {
		if (!Object.hasOwn(SCHEMAS, entityType))
			fail(
				"UNSUPPORTED_ENTITY",
				"This version imports contacts and companies only; deals require pipeline acceptance",
			);
		if (
			!Array.isArray(mapping) ||
			mapping.length > Object.keys(SCHEMAS[entityType]).length
		)
			fail("INVALID_MAPPING", "Mapping is invalid");
		const result = await prep.plan({
			context: c,
			sourceId: sourceRow.id,
			expectedSha256: sourceRow.sha256,
			entityType,
			mapping,
			targetSchema: SCHEMAS[entityType],
			batchSize: BATCH_SIZE,
			validateRecord: (record) => fields(record, entityType),
		});
		return result.plan;
	}
	async function storedPlan(c, row) {
		if (row.mapping.schemaVersion !== "crm-create-only-v1")
			fail(
				"PLAN_VERSION",
				"The import schema changed; this job needs operator review",
			);
		const s = await source(db, c, row.sourceId);
		if (s.sha256 !== row.sourceSha256)
			fail("SOURCE_CHANGED", "Source binding changed");
		const result = await plan(c, s, row.entityType, row.mapping.fields);
		if (result.idempotencyKey !== row.mapping.planIdentity)
			fail(
				"PLAN_CHANGED",
				"Persisted source and mapping no longer reproduce the accepted plan",
			);
		return result;
	}
	function coordinator(client = db, repositoryOptions = {}) {
		return createMigrationCoordinator({
			repository: createPrismaMigrationRepository(client, repositoryOptions),
			clock,
			leaseMs: 120000,
			maxAttempts: 3,
		});
	}
	function coordinatorInside(client) {
		// Reuse coordinator state invariants without opening a nested DB transaction.
		const borrowed = {
			$transaction: (callback) => callback(client),
			crmMigrationJob: client.crmMigrationJob,
			crmMigrationBatch: client.crmMigrationBatch,
			crmMigrationEvent: client.crmMigrationEvent,
		};
		// The outer tx() owns retries. A borrowed transaction cannot be retried
		// after PostgreSQL aborts it; querying it would replace P2034 with 25P02.
		return coordinator(borrowed, { transactionMaxAttempts: 1 });
	}
	return {
		time,
		context,
		authorize,
		configured,
		tx,
		source,
		job,
		event,
		plan,
		storedPlan,
		coordinator,
		coordinatorInside,
	};
}

async function migrationReportSnapshot(
	job,
	client,
	c,
	jobId,
	afterRow,
	pageSize,
) {
	const row = await job(client, c, jobId);
	const receipts = await client.crmMigrationRowReceipt.findMany({
		where: { workspaceId: c.tenantId, jobId },
		orderBy: { rowNumber: "asc" },
		take: MAX_ROWS + 1,
	});
	const issues = await client.crmMigrationIssue.findMany({
		where: { workspaceId: c.tenantId, jobId },
		orderBy: { rowNumber: "asc" },
		take: MAX_ROWS * 2 + 1,
	});
	if (receipts.length > MAX_ROWS || issues.length > MAX_ROWS * 2)
		fail("REPORT_LIMIT", "Job exceeds the report safety bound");
	const invalidRows = new Set(
		issues.filter((x) => x.severity === "ERROR").map((x) => x.rowNumber),
	);
	const receiptRows = new Set(receipts.map((x) => x.rowNumber));
	const overlap = [...receiptRows].some((n) => invalidRows.has(n));
	const created = receipts.filter((x) =>
		["CREATED", "ROLLED_BACK"].includes(x.status),
	).length;
	const duplicates = receipts.filter((x) => x.status === "DUPLICATE").length;
	const rejected =
		invalidRows.size + receipts.filter((x) => x.status === "REJECTED").length;
	const rolledBack = receipts.filter((x) => x.status === "ROLLED_BACK").length;
	const accounted = created + duplicates + rejected;
	const countersAgree =
		row.acceptedRows === created && row.rejectedRows === duplicates + rejected;
	const issuesByRow = new Map();
	for (const value of issues) {
		const existing = issuesByRow.get(value.rowNumber) ?? [];
		existing.push(issue(value));
		issuesByRow.set(value.rowNumber, existing);
	}
	const allRows = [...new Set([...receiptRows, ...invalidRows])]
		.sort((a, b) => a - b)
		.filter((n) => n > afterRow);
	const byNumber = new Map(receipts.map((r) => [r.rowNumber, r]));
	const rows = allRows.slice(0, pageSize).map((n) => ({
		rowNumber: n,
		status: byNumber.get(n)?.status ?? "REJECTED",
		code:
			byNumber.get(n)?.code ??
			issuesByRow.get(n)?.[0]?.code ??
			"ROW_VALIDATION_FAILED",
		entityId: byNumber.get(n)?.entityId ?? null,
		issues: issuesByRow.get(n) ?? [],
	}));
	return {
		jobId,
		background: {
			enabled: row.backgroundEnabled,
			lastErrorCode: row.backgroundLastErrorCode ?? null,
			nextAttemptAt: row.backgroundNextAttemptAt
				? new Date(row.backgroundNextAttemptAt).toISOString()
				: null,
		},
		sourceFilename: row.sourceFilename,
		entityType: row.entityType,
		status: row.status,
		totalRows: row.totalRows,
		created,
		duplicates,
		rejected,
		rolledBack,
		remaining: Math.max(0, row.totalRows - accounted),
		reconciliation: {
			ok:
				!overlap &&
				receiptRows.size === receipts.length &&
				accounted === row.totalRows &&
				countersAgree,
			countersAgree,
			explanation:
				"Persisted row receipts plus validation issues; not a claim that unchanged CRM records or downstream business results are guaranteed",
		},
		rows,
		nextAfterRow: allRows.length > pageSize ? rows.at(-1).rowNumber : null,
	};
}

async function duplicate(client, entityType, record) {
	const or = [];
	if (entityType === "contact") {
		if (record.email)
			or.push({ email: { equals: record.email, mode: "insensitive" } });
		if (record.phone)
			or.push({
				phone: {
					in: [record.phone, record.phone.slice(1), record.phone.slice(4)],
				},
			});
	} else {
		if (record.domain)
			or.push({ domain: { equals: record.domain, mode: "insensitive" } });
		if (record.name)
			or.push({ name: { equals: record.name, mode: "insensitive" } });
	}
	// No fuzzy matching and no overwrite/merge of an existing customer record.
	return client[entityType].findMany({
		where: { archivedAt: null, OR: or },
		select: { id: true },
		take: 2,
	});
}

async function dependencies(client, entityType, id) {
	const key = entityType === "contact" ? "contactId" : "companyId";
	const models =
		entityType === "contact"
			? [
					"activity",
					"dealContact",
					"agentConversation",
					"emailThread",
					"calendarEvent",
					"calendarAttendee",
					"fieldValue",
					"contactFact",
					"contactBrief",
					"trackedVisitor",
					"formSubmission",
				]
			: [
					"contact",
					"deal",
					"activity",
					"agentConversation",
					"emailThread",
					"calendarEvent",
					"fieldValue",
				];
	for (const model of models) {
		if ((await client[model].count({ where: { [key]: id } })) > 0) return true;
	}
	if (
		entityType === "contact" &&
		(await client.company.count({ where: { primaryContactId: id } }))
	)
		return true;
	if (
		entityType === "company" &&
		(await client.companyEnrichment.count({ where: { companyId: id } }))
	)
		return true;
	return false;
}

/** Dedicated-workspace, create-only import application. No provider side effects. */
export function createMigrationApplication({
	db,
	sourceStore,
	workspaceId,
	clock = () => new Date(),
	enabled = false,
	executeEnabled = false,
	backgroundEnabled = false,
}) {
	identifier(workspaceId);
	const prep = sourceStore
		? createMigrationSourcePreparation({
				store: sourceStore,
				maxBytes: MAX_BYTES,
				maxRows: MAX_ROWS,
			})
		: null;
	const {
		time,
		context,
		authorize,
		configured,
		tx,
		source,
		job,
		event,
		plan,
		storedPlan,
		coordinator,
		coordinatorInside,
	} = createMigrationScope({
		db,
		workspaceId,
		clock,
		enabled,
		executeEnabled,
		prep,
	});
	async function importClaim(c, row, dryRun, claim, backgroundClaim = null) {
		return tx(c, async (client) => {
			const current = await job(client, c, row.id);
			// A pause drains an already claimed batch; cancellation still fences the transaction.
			if (!backgroundClaim && current.backgroundEnabled)
				fail(
					"BACKGROUND_ACTIVE",
					"Pause background processing before executing manually",
				);
			if (current.status !== "IMPORTING")
				fail("JOB_STOPPED", "Import was stopped");
			// A no-change guarded write takes a job row lock. Cancel/rollback cannot acknowledge
			// ahead of this transaction then be followed by its late customer writes.
			const locked = await client.crmMigrationJob.updateMany({
				where: {
					id: row.id,
					workspaceId: c.tenantId,
					version: current.version,
					status: "IMPORTING",
				},
				data: { version: current.version, updatedAt: current.updatedAt },
			});
			if (locked.count !== 1)
				fail("STALE_JOB", "Import changed while locking it");
			const batch = await client.crmMigrationBatch.findFirst({
				where: {
					workspaceId: c.tenantId,
					jobId: row.id,
					batchIndex: claim.batchIndex,
					status: "RUNNING",
					leaseOwner: claim.lease.owner,
					version: claim.lease.version,
					leaseExpiresAt: { gt: time() },
				},
			});
			if (!batch) fail("LEASE_LOST", "Batch lease is no longer valid");
			const owner = await client.member.findFirst({
				where: { organizationId: c.tenantId, userId: row.createdById },
			});
			if (!owner)
				fail(
					"OWNER_NOT_MEMBER",
					"The planned record owner is no longer a workspace member",
				);
			const expected = dryRun.batches[claim.batchIndex];
			if (
				!expected ||
				expected.digest !== claim.digest ||
				expected.count !== batch.rowCount
			)
				fail("PLAN_CHANGED", "Claimed batch differs from the accepted plan");
			let importedCount = 0,
				rejectedCount = 0;
			for (const item of expected.records) {
				const number = item.record.sourceRowNumber;
				const key = {
					workspaceId: c.tenantId,
					jobId: row.id,
					rowNumber: number,
				};
				let receipt = await client.crmMigrationRowReceipt.findFirst({
					where: key,
				});
				if (receipt) {
					if (
						receipt.fingerprint !== item.fingerprint ||
						receipt.batchIndex !== claim.batchIndex ||
						!["CREATED", "DUPLICATE", "REJECTED"].includes(receipt.status)
					)
						fail(
							"RECEIPT_CONFLICT",
							"A recorded row does not match this import attempt",
						);
				} else {
					const values = fields(item.record, row.entityType);
					const matches = await duplicate(client, row.entityType, values);
					let status = "DUPLICATE",
						code = "EXACT_DUPLICATE",
						record = null;
					if (matches.length > 1) {
						status = "REJECTED";
						code = "AMBIGUOUS_DUPLICATE";
					}
					if (!matches.length) {
						const recordId = `mig_${hash([c.tenantId, row.id, number]).slice(0, 40)}`;
						record = await client[row.entityType].create({
							data: {
								id: recordId,
								...values,
								source: "IMPORT",
								ownerId: row.createdById,
							},
							select: { id: true, updatedAt: true },
						});
						status = "CREATED";
						code = "CREATED";
					}
					receipt = await client.crmMigrationRowReceipt.create({
						data: {
							id: `mr_${hash([c.tenantId, row.id, number]).slice(0, 40)}`,
							...key,
							batchIndex: claim.batchIndex,
							fingerprint: item.fingerprint,
							entityType: row.entityType,
							entityId:
								record?.id ?? (matches.length === 1 ? matches[0].id : null),
							status,
							code,
							recordUpdatedAt: record?.updatedAt ?? null,
							createdAt: time(),
						},
					});
				}
				if (receipt.status === "CREATED") importedCount++;
				else rejectedCount++;
			}
			// The batch lease is checked again before commit; late rows never commit after expiry.
			const fresh = await client.crmMigrationBatch.findFirst({
				where: {
					id: batch.id,
					workspaceId: c.tenantId,
					version: claim.lease.version,
					leaseOwner: claim.lease.owner,
					status: "RUNNING",
					leaseExpiresAt: { gt: time() },
				},
			});
			if (!fresh)
				fail("LEASE_LOST", "Batch lease expired before committing records");
			await event(client, c, row.id, "migration.rows.committed", {
				batchIndex: claim.batchIndex,
				importedCount,
				rejectedCount,
			});
			return { importedCount, rejectedCount };
		});
	}
	async function rollbackRows(client, c, row, afterRow, apply) {
		const receipts = await client.crmMigrationRowReceipt.findMany({
			where: {
				workspaceId: c.tenantId,
				jobId: row.id,
				rowNumber: { gt: afterRow },
				status: { in: ["CREATED", "ROLLED_BACK"] },
			},
			orderBy: { rowNumber: "asc" },
			take: 51,
		});
		const page = receipts.slice(0, 50),
			results = [];
		for (const receipt of page) {
			if (receipt.status === "ROLLED_BACK") {
				results.push({
					rowNumber: receipt.rowNumber,
					result: "ALREADY_ROLLED_BACK",
				});
				continue;
			}
			const record = await client[row.entityType].findFirst({
				where: { id: receipt.entityId },
				select: { id: true, source: true, updatedAt: true, archivedAt: true },
			});
			let result = !record
				? "MISSING_RECORD"
				: record.source !== "IMPORT" ||
						record.archivedAt ||
						new Date(record.updatedAt).getTime() !==
							new Date(receipt.recordUpdatedAt).getTime()
					? "RECORD_CHANGED"
					: (await dependencies(client, row.entityType, record.id))
						? "RECORD_IN_USE"
						: "CAN_ARCHIVE";
			if (apply && result === "CAN_ARCHIVE") {
				const at = time();
				const updated = await client[row.entityType].updateMany({
					where: {
						id: record.id,
						source: "IMPORT",
						archivedAt: null,
						updatedAt: record.updatedAt,
					},
					data: { archivedAt: at },
				});
				if (updated.count !== 1)
					fail(
						"ROLLBACK_CONFLICT",
						"A record changed during rollback; no rows in this transaction were archived",
					);
				const receiptUpdated = await client.crmMigrationRowReceipt.updateMany({
					where: { id: receipt.id, workspaceId: c.tenantId, status: "CREATED" },
					data: { status: "ROLLED_BACK", rolledBackAt: at },
				});
				if (receiptUpdated.count !== 1)
					fail(
						"ROLLBACK_CONFLICT",
						"The rollback receipt changed concurrently",
					);
				result = "ARCHIVED";
			}
			results.push({ rowNumber: receipt.rowNumber, result });
		}
		if (apply)
			await event(client, c, row.id, "migration.rollback.page", {
				afterRow,
				results,
			});
		return {
			rows: results,
			nextAfterRow: receipts.length > 50 ? page.at(-1).rowNumber : null,
			destructiveDelete: false,
		};
	}
	const reportSnapshot = (...args) => migrationReportSnapshot(job, ...args);
	async function executeBatch(inputContext, jobId, backgroundClaim = null) {
		const c = context(inputContext);
		await authorize(db, c);
		configured(true);
		const row = await job(db, c, jobId);
		if (backgroundClaim)
			assertBackgroundClaim(row, backgroundClaim, time(), fail);
		else if (row.backgroundEnabled)
			fail(
				"BACKGROUND_ACTIVE",
				"Pause background processing before executing manually",
			);
		if (row.status === "COMPLETED")
			return { jobId: row.id, status: row.status, done: true, busy: false };
		const dryRun = await storedPlan(c, row);
		if (row.status === "READY")
			await tx(c, async (client) => {
				const current = await job(client, c, jobId);
				if (current.status === "READY")
					await coordinatorInside(client).startJob({ context: c, jobId });
			});
		if (backgroundClaim)
			assertBackgroundClaim(
				await job(db, c, jobId),
				backgroundClaim,
				time(),
				fail,
			);
		const result = await coordinator().runNextBatch({
			context: c,
			jobId,
			workerId: `api-${randomUUID()}`,
			importBatch: (claim) =>
				importClaim(c, row, dryRun, claim, backgroundClaim),
		});
		return {
			jobId,
			status: result.job.status,
			done: !!result.done,
			busy: !!result.busy,
		};
	}
	const background = createBackgroundImport({
		db,
		workspaceId,
		context,
		authorize,
		tx,
		job,
		event,
		time,
		configured,
		fail,
		executeBatch,
		enabled: backgroundEnabled,
	});
	const lifecycle = createSourceLifecycle({
		db,
		store: sourceStore,
		context,
		authorize,
		tx,
		source,
		time,
		configured,
		fail,
	});
	return Object.freeze({
		cleanupSources: lifecycle.cleanup,
		setBackground: background.configure,
		runBackgroundOnce: background.runOnce,
		async capabilities(inputContext) {
			const c = context(inputContext);
			await authorize(db, c);
			return {
				configured: enabled && !!prep,
				executionEnabled: enabled && !!prep && executeEnabled,
				backgroundEnabled:
					enabled && !!prep && executeEnabled && backgroundEnabled,
				maxBytes: MAX_BYTES,
				maxRows: MAX_ROWS,
				formats: ["CSV", "TSV"],
				entityTypes: Object.keys(SCHEMAS),
				fields: Object.fromEntries(
					Object.entries(SCHEMAS).map(([entity, schema]) => [
						entity,
						Object.entries(schema).map(([key, field]) => ({
							key,
							required: field.required === true,
						})),
					]),
				),
				policy: "CREATE_ONLY_SKIP_EXACT_DUPLICATES",
				dedicatedWorkspace: true,
			};
		},
		async list(inputContext) {
			const c = context(inputContext);
			await authorize(db, c);
			configured();
			const sources = await db.crmMigrationSource.findMany({
				where: { workspaceId: c.tenantId, purgedAt: null },
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				take: 25,
			});
			const jobs = await db.crmMigrationJob.findMany({
				where: { workspaceId: c.tenantId, sourceId: { not: null } },
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				take: 25,
				select: {
					id: true,
					sourceFilename: true,
					entityType: true,
					status: true,
					totalRows: true,
					acceptedRows: true,
					rejectedRows: true,
					createdAt: true,
					backgroundEnabled: true,
					backgroundLastErrorCode: true,
					backgroundNextAttemptAt: true,
				},
			});
			return {
				sources: sources.map(metadata),
				jobs: jobs.map((j) => ({
					...j,
					createdAt: new Date(j.createdAt).toISOString(),
					backgroundNextAttemptAt: j.backgroundNextAttemptAt
						? new Date(j.backgroundNextAttemptAt).toISOString()
						: null,
				})),
				limit: 25,
			};
		},
		async upload(inputContext, { filename, mimeType, base64 }) {
			const c = context(inputContext);
			await authorize(db, c);
			configured();
			if (
				typeof base64 !== "string" ||
				base64.length > Math.ceil(MAX_BYTES / 3) * 4 ||
				!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
			)
				fail(
					"INVALID_UPLOAD",
					"File exceeds the upload limit or is not canonical base64",
				);
			const bytes = Buffer.from(base64, "base64");
			if (!bytes.length || bytes.toString("base64") !== base64)
				fail("INVALID_UPLOAD", "Upload encoding is invalid");
			// Quota is rechecked transactionally before metadata publication. A process crash can
			// leave an encrypted orphan, never a public unencrypted file; runbook covers reconciliation.
			if (
				(await db.crmMigrationSource.count({
					where: { workspaceId: c.tenantId, deletedAt: null },
				})) >= 20
			)
				fail(
					"SOURCE_QUOTA",
					"The workspace has reached its active source limit",
				);
			let result;
			try {
				result = await prep.upload({ context: c, filename, mimeType, bytes });
			} finally {
				bytes.fill(0);
			}
			await tx(c, async (client) => {
				if (
					(await client.crmMigrationSource.count({
						where: { workspaceId: c.tenantId, deletedAt: null },
					})) >= 20
				)
					fail(
						"SOURCE_QUOTA",
						"The workspace has reached its active source limit",
					);
				await client.crmMigrationSource.create({
					data: {
						id: result.source.id,
						workspaceId: c.tenantId,
						createdById: c.actorId,
						filename: result.source.filename,
						mimeType,
						sha256: result.source.sha256,
						byteLength: result.source.byteLength,
						format: result.source.format,
						createdAt: time(),
					},
				});
			});
			return result;
		},
		async preview(inputContext, { sourceId, expectedSha256 }) {
			const c = context(inputContext);
			await authorize(db, c);
			configured();
			const s = await source(db, c, sourceId);
			if (s.sha256 !== digest(expectedSha256))
				fail("SOURCE_CHANGED", "Source fingerprint does not match");
			return prep.preview({
				context: c,
				sourceId: s.id,
				expectedSha256: s.sha256,
			});
		},
		async prepare(
			inputContext,
			{ sourceId, expectedSha256, entityType, mapping, commandId },
		) {
			const c = context(inputContext);
			await authorize(db, c);
			configured();
			const s = await source(db, c, sourceId);
			if (s.sha256 !== digest(expectedSha256))
				fail("SOURCE_CHANGED", "Source fingerprint does not match");
			const dryRun = await plan(c, s, entityType, mapping);
			const jobId = `mj_${hash([c.tenantId, c.actorId, identifier(commandId)]).slice(0, 40)}`;
			const envelope = {
				applicationVersion: 1,
				schemaVersion: "crm-create-only-v1",
				fields: mapping.map(({ source, target }) => ({ source, target })),
				planIdentity: dryRun.idempotencyKey,
			};
			const requestDigest = hash([s.id, s.sha256, entityType, envelope]);
			const prepared = await tx(c, async (client) => {
				const liveSource = await source(client, c, sourceId);
				await lifecycle.lock(client, c, liveSource);
				const existing = await client.crmMigrationJob.findFirst({
					where: { workspaceId: c.tenantId, id: jobId },
				});
				if (existing) {
					if (existing.mapping?.requestDigest !== requestDigest)
						fail(
							"COMMAND_REUSED",
							"A command identity cannot be reused for another mapping",
						);
					return existing;
				}
				const created = await coordinatorInside(client).createPlannedJob({
					context: c,
					jobId,
					entityType,
					sourceFormat: s.format,
					sourceFilename: s.filename,
					sourceSha256: s.sha256,
					sourceId: s.id,
					mapping: { ...envelope, requestDigest },
					dryRun,
				});
				if (dryRun.issues.length)
					await client.crmMigrationIssue.createMany({
						data: dryRun.issues.map((value) => ({
							workspaceId: c.tenantId,
							jobId,
							...issue(value),
							message:
								"See the row issue code; source values remain in the encrypted file",
						})),
					});
				return created;
			});
			return {
				jobId,
				status: prepared.status,
				stats: dryRun.stats,
				issues: dryRun.issues.slice(0, 100).map(issue),
				issueCount: dryRun.issues.length,
				ownerId: c.actorId,
				planIdentity: dryRun.idempotencyKey,
				existingDatabaseDedupe: "CHECKED_AT_EXECUTION",
				writesPerformed: false,
			};
		},
		executeNext(inputContext, { jobId }) {
			return executeBatch(inputContext, jobId);
		},
		async cancel(inputContext, { jobId }) {
			const c = context(inputContext);
			await authorize(db, c);
			configured();
			return tx(c, async (client) => {
				const row = await job(client, c, jobId);
				if (row.status === "CANCELLED") return { jobId, status: row.status };
				if (TERMINAL.has(row.status))
					fail("JOB_TERMINAL", "A finished job cannot be cancelled");
				const result = await coordinatorInside(client).cancelJob({
					context: c,
					jobId,
				});
				await client.crmMigrationJob.updateMany({
					where: { workspaceId: c.tenantId, id: jobId },
					data: {
						backgroundEnabled: false,
						backgroundNextAttemptAt: null,
						backgroundVersion: { increment: 1 },
					},
				});
				return { jobId, status: result.status };
			});
		},
		async report(inputContext, { jobId, afterRow = 0 }) {
			const c = context(inputContext);
			await authorize(db, c);
			configured();
			if (!Number.isSafeInteger(afterRow) || afterRow < 0)
				fail("INVALID_INPUT", "Invalid row cursor");
			return tx(c, async (client) => {
				return reportSnapshot(client, c, jobId, afterRow, 100);
			});
		},
		async exportReport(inputContext, { jobId }) {
			const c = context(inputContext);
			await authorize(db, c);
			configured();
			return tx(c, async (client) => {
				const snapshot = await reportSnapshot(client, c, jobId, 0, MAX_ROWS);
				if (!TERMINAL.has(snapshot.status))
					fail(
						"JOB_ACTIVE",
						"Finish or cancel the import before exporting its final persisted row outcomes",
					);
				if (snapshot.nextAfterRow !== null)
					fail(
						"REPORT_LIMIT",
						"The full report does not fit the verified export bound",
					);
				const exportedAt = time().toISOString();
				const content =
					"\uFEFF" +
					serializeCsv({
						headers: [
							"Record type",
							"Job ID",
							"Source file",
							"Job status",
							"Entity type",
							"Total source rows",
							"Remaining rows",
							"Reconciled",
							"Exported at UTC",
							"Source row",
							"Outcome",
							"Reason",
							"Entity ID",
							"Validation codes",
						],
						rows: [
							[
								"SUMMARY",
								snapshot.jobId,
								snapshot.sourceFilename,
								snapshot.status,
								snapshot.entityType,
								snapshot.totalRows,
								snapshot.remaining,
								snapshot.reconciliation.ok,
								exportedAt,
								"",
								"",
								"",
								"",
								"",
							],
							...snapshot.rows.map((row) => [
								"ROW",
								snapshot.jobId,
								snapshot.sourceFilename,
								snapshot.status,
								snapshot.entityType,
								snapshot.totalRows,
								snapshot.remaining,
								snapshot.reconciliation.ok,
								exportedAt,
								row.rowNumber,
								row.status,
								row.code,
								row.entityId ?? "",
								row.issues.map((x) => x.code).join(" | "),
							]),
						],
					});
				if (Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024)
					fail(
						"REPORT_LIMIT",
						"The serialized report exceeds the safe download limit",
					);
				await event(client, c, jobId, "migration.report.exported", {
					rowCount: snapshot.rows.length,
					reconciled: snapshot.reconciliation.ok,
					remaining: snapshot.remaining,
				});
				return {
					filename: `migration-${jobId}-report.csv`,
					mimeType: "text/csv;charset=utf-8",
					content,
					rowCount: snapshot.rows.length,
					remaining: snapshot.remaining,
					reconciled: snapshot.reconciliation.ok,
					exportedAt,
				};
			});
		},
		async rollback(
			inputContext,
			{ jobId, afterRow = 0, apply = false, confirmation },
		) {
			const c = context(inputContext);
			await authorize(db, c);
			configured(apply);
			if (
				!Number.isSafeInteger(afterRow) ||
				afterRow < 0 ||
				typeof apply !== "boolean"
			)
				fail("INVALID_INPUT", "Invalid rollback request");
			if (apply && confirmation !== jobId)
				fail(
					"CONFIRMATION_REQUIRED",
					"Confirm the exact job identity before archiving imported records",
				);
			return tx(c, async (client) => {
				const row = await job(client, c, jobId);
				if (!TERMINAL.has(row.status))
					fail("JOB_ACTIVE", "Stop the import before preparing rollback");
				const live = await client.crmMigrationBatch.count({
					where: {
						workspaceId: c.tenantId,
						jobId,
						status: "RUNNING",
						leaseExpiresAt: { gt: time() },
					},
				});
				if (live)
					fail(
						"BATCH_ACTIVE",
						"Wait for active batch leases to settle before rollback",
					);
				return rollbackRows(client, c, row, afterRow, apply);
			});
		},
		removeSource: lifecycle.remove,
	});
}
export async function createMigrationApplicationFromEnvironment({
	db,
	workspaceId,
	environment = process.env,
}) {
	const enabled = environment.MIGRATION_CENTER_ENABLED === "1";
	const executeEnabled = environment.MIGRATION_EXECUTION_ENABLED === "1";
	if (!enabled)
		return createMigrationApplication({ db, workspaceId, enabled: false });
	const root = environment.MIGRATION_SOURCE_ROOT;
	if (typeof root !== "string" || !root.startsWith("/"))
		fail(
			"NOT_CONFIGURED",
			"Set an absolute private MIGRATION_SOURCE_ROOT on a durable mounted volume",
		);
	let encoded;
	try {
		encoded = JSON.parse(environment.MIGRATION_SOURCE_KEYS_JSON ?? "");
	} catch {
		fail("NOT_CONFIGURED", "Source encryption keyring is invalid");
	}
	if (
		!encoded ||
		typeof encoded !== "object" ||
		Array.isArray(encoded) ||
		Object.keys(encoded).length > 10
	)
		fail("NOT_CONFIGURED", "Source encryption keyring is invalid");
	const keys = Object.create(null);
	for (const [key, value] of Object.entries(encoded)) {
		if (typeof value !== "string" || value.length !== 44)
			fail(
				"NOT_CONFIGURED",
				"Source keys must be canonical base64-encoded 32-byte values",
			);
		const bytes = Buffer.from(value, "base64");
		if (bytes.length !== 32 || bytes.toString("base64") !== value)
			fail("NOT_CONFIGURED", "Source encryption keyring is invalid");
		keys[key] = bytes;
	}
	const sourceStore = await createEncryptedFileSourceStore({
		root,
		keys,
		activeKeyId: environment.MIGRATION_SOURCE_ACTIVE_KEY,
		maxBytes: MAX_BYTES,
	});
	for (const key of Object.values(keys)) key.fill(0);
	return createMigrationApplication({
		db,
		sourceStore,
		workspaceId,
		enabled,
		executeEnabled,
		backgroundEnabled: environment.MIGRATION_BACKGROUND_ENABLED === "1",
	});
}
export function publicMigrationError(error) {
	if (error?.code === "FORBIDDEN")
		return {
			status: 403,
			message: "Only a current workspace owner or admin can manage imports.",
		};
	if (["NOT_FOUND", "SOURCE_NOT_FOUND"].includes(error?.code))
		return {
			status: 404,
			message: "The import or its source is not available in this workspace.",
		};
	if (
		[
			"BACKGROUND_DISABLED",
			"NOT_CONFIGURED",
			"EXECUTION_DISABLED",
			"LEGACY_JOB",
		].includes(error?.code)
	)
		return {
			status: 412,
			message:
				"This operation needs deployment configuration or database acceptance. No new batch was started.",
		};
	if (
		[
			"SOURCE_CHANGED",
			"BACKGROUND_PAUSED",
			"BACKGROUND_ACTIVE",
			"SOURCE_IN_USE",
			"COMMAND_REUSED",
			"JOB_ACTIVE",
			"BATCH_ACTIVE",
			"JOB_TERMINAL",
			"STALE_JOB",
			"LEASE_LOST",
			"JOB_STOPPED",
			"JOB_NOT_IMPORTING",
		].includes(error?.code)
	)
		return {
			status: 409,
			message:
				"The import state changed or this resource is in use. Refresh the report before continuing.",
		};
	if (error?.code === "SOURCE_QUOTA")
		return {
			status: 429,
			message:
				"The active source limit has been reached. Remove unused sources or contact the deployment administrator.",
		};
	if (
		[
			"MigrationApplicationError",
			"MigrationDomainError",
			"MigrationRuntimeError",
		].includes(error?.name)
	)
		return {
			status: 400,
			message:
				"The file, mapping or operation could not be validated. Check UTF-8 encoding, required fields and import limits. Previously committed rows remain in the report.",
		};
	return {
		status: 500,
		message:
			"The operation could not be completed. Saved sources and committed row receipts are retained. Refresh the report before retrying.",
	};
}
