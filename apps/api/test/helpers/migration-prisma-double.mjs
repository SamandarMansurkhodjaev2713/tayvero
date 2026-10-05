/** Transactional query-contract double, NOT PostgreSQL or concurrency proof. */
export function migrationPrismaDouble(seed = {}) {
	const models = [
		"crmMigrationSourceEvent",
		"member",
		"crmMigrationSource",
		"crmMigrationJob",
		"crmMigrationBatch",
		"crmMigrationIssue",
		"crmMigrationEvent",
		"crmMigrationRowReceipt",
		"contact",
		"company",
		"activity",
		"dealContact",
		"deal",
		"agentConversation",
		"emailThread",
		"calendarEvent",
		"fieldValue",
		"contactFact",
		"trackedVisitor",
		"formSubmission",
		"calendarAttendee",
		"contactBrief",
		"companyEnrichment",
		"governedActionApproval",
		"governedActionAuditEvent",
		"governedActionReceipt",
		"agentRun",
		"agentVersion",
		"agentDefinition",
		"agentAction",
		"governedActionContinuation",
	];
	const state = Object.fromEntries(
		models.map((model) => [model, structuredClone(seed[model] ?? [])]),
	);
	const calls = [];
	let seq = 0,
		queue = Promise.resolve(),
		hook;
	const comparable = (v) => (v instanceof Date ? v.getTime() : v);
	const matchValue = (value, spec) => {
		if (spec instanceof Date) return comparable(value) === comparable(spec);
		if (!spec || typeof spec !== "object" || Array.isArray(spec))
			return (value ?? null) === (spec ?? null);
		return Object.entries(spec).every(([operator, expected]) => {
			if (operator === "mode") return true;
			if (operator === "equals")
				return spec.mode === "insensitive"
					? String(value ?? "").toLowerCase() === String(expected).toLowerCase()
					: matchValue(value, expected);
			if (operator === "in") return expected.some((v) => matchValue(value, v));
			if (operator === "not") return !matchValue(value, expected);
			if (operator === "gt") return comparable(value) > comparable(expected);
			if (operator === "gte") return comparable(value) >= comparable(expected);
			if (operator === "lt") return comparable(value) < comparable(expected);
			if (operator === "lte") return comparable(value) <= comparable(expected);
			throw new Error(`Unsupported test predicate ${operator}`);
		});
	};
	const match = (row, where = {}) =>
		Object.entries(where).every(([key, spec]) => {
			if (key === "OR") return spec.some((w) => match(row, w));
			if (key === "AND")
				return (Array.isArray(spec) ? spec : [spec]).every((w) =>
					match(row, w),
				);
			if (key === "NOT") return !match(row, spec);
			if (
				!(key in row) &&
				spec &&
				typeof spec === "object" &&
				key.includes("_") &&
				!Object.keys(spec).some((k) =>
					["in", "not", "gt", "lt", "equals"].includes(k),
				)
			)
				return match(row, spec);
			return matchValue(row[key], spec);
		});
	const project = (row, select) =>
		row == null
			? null
			: !select
				? structuredClone(row)
				: Object.fromEntries(
						Object.entries(select)
							.filter(([, v]) => v)
							.map(([key]) => [key, structuredClone(row[key] ?? null)]),
					);
	const unique = {
		governedActionContinuation: ["workspaceId", "runId", "callId"],
		governedActionApproval: ["id"],
		crmMigrationSource: ["id"],
		crmMigrationJob: ["id"],
		crmMigrationBatch: ["workspaceId", "jobId", "batchIndex"],
		crmMigrationRowReceipt: ["workspaceId", "jobId", "rowNumber"],
		contact: ["id"],
		company: ["id"],
	};
	const delegates = {};
	for (const model of models) {
		const run = async (operation, args, fn) => {
			calls.push({ model, operation, args: structuredClone(args) });
			await hook?.(model, operation, args);
			return fn();
		};
		const find = (args) => {
			let rows = state[model].filter((row) => match(row, args?.where));
			const order = Array.isArray(args?.orderBy)
				? args.orderBy
				: args?.orderBy
					? [args.orderBy]
					: [];
			if (order.length)
				rows.sort((a, b) => {
					for (const field of order) {
						const [key, dir] = Object.entries(field)[0];
						const x = comparable(a[key]),
							y = comparable(b[key]);
						if (x !== y) return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1);
					}
					return 0;
				});
			if (args?.take != null) rows = rows.slice(0, args.take);
			return rows;
		};
		delegates[model] = {
			findFirst: async (args) =>
				run("findFirst", args, () => project(find(args)[0], args?.select)),
			findUnique: async (args) =>
				run("findUnique", args, () => project(find(args)[0], args?.select)),
			findMany: async (args = {}) =>
				run("findMany", args, () =>
					find(args).map((row) => project(row, args.select)),
				),
			count: async (args = {}) => run("count", args, () => find(args).length),
			create: async ({ data, select }) =>
				run("create", { data, select }, () => {
					const key = unique[model];
					if (
						key &&
						state[model].some((row) => key.every((k) => row[k] === data[k]))
					) {
						const e = new Error("unique");
						e.code = "P2002";
						throw e;
					}
					const row = {
						id: `test-${++seq}`,
						createdAt: new Date("2026-09-14T10:00:00Z"),
						updatedAt: new Date("2026-09-14T10:00:00Z"),
						archivedAt: null,
						deletedAt: null,
						purgedAt: null,
						version: 1,
						backgroundEnabled: false,
						backgroundRequestedById: null,
						backgroundNextAttemptAt: null,
						backgroundVersion: 0,
						backgroundFailureCount: 0,
						backgroundLastErrorCode: null,
						...structuredClone(data),
					};
					state[model].push(row);
					return project(row, select);
				}),
			createMany: async ({ data }) => {
				for (const row of data) await delegates[model].create({ data: row });
				return { count: data.length };
			},
			updateMany: async ({ where, data }) =>
				run("updateMany", { where, data }, () => {
					const rows = state[model].filter((row) => match(row, where));
					for (const row of rows) {
						for (const [key, value] of Object.entries(data)) {
							row[key] =
								value && typeof value === "object" && "increment" in value
									? (row[key] ?? 0) + value.increment
									: structuredClone(value);
						}
					}
					return { count: rows.length };
				}),
			deleteMany: async ({ where }) =>
				run("deleteMany", { where }, () => {
					const before = state[model].length;
					state[model] = state[model].filter((row) => !match(row, where));
					return { count: before - state[model].length };
				}),
		};
	}
	const db = {
		...delegates,
		async $transaction(callback, options) {
			calls.push({ operation: "transaction", options });
			let release;
			const previous = queue;
			queue = new Promise((resolve) => {
				release = resolve;
			});
			await previous;
			const snapshot = structuredClone(state);
			try {
				return await callback(delegates);
			} catch (e) {
				for (const model of models) state[model] = snapshot[model];
				throw e;
			} finally {
				release();
			}
		},
	};
	return {
		db,
		state,
		calls,
		setHook: (fn) => {
			hook = fn;
		},
	};
}
