import { fail } from "./errors.mjs";
import { validateSchema } from "./schema.mjs";

const ACTION_ID_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PERMISSION_PATTERN = /^(?:\*|[a-z][a-z0-9_.:-]{0,127})$/;
const RISK_ALIASES = Object.freeze({
	READ: "LOW",
	WRITE: "MEDIUM",
	IRREVERSIBLE: "CRITICAL",
});
const ALLOWED_RISKS = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const IDEMPOTENCY_ALIASES = Object.freeze({ REQUIRED: "KEYED" });
const ALLOWED_IDEMPOTENCY = new Set(["NONE", "KEYED", "INHERENT"]);
const ALLOWED_OPTION_KEYS = new Set(["entries"]);

function isPlainRecord(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function assertPlainRecord(value, code, message) {
	if (!isPlainRecord(value)) fail(code, message);
	return value;
}

function normalizeString(value, field, { max = 512, pattern } = {}) {
	if (typeof value !== "string")
		fail("INVALID_MANIFEST", `${field} must be a string`, { field });
	const normalized = value.trim();
	if (
		normalized === "" ||
		normalized.length > max ||
		(pattern && !pattern.test(normalized))
	) {
		fail("INVALID_MANIFEST", `${field} is invalid`, { field });
	}
	return normalized;
}

function cloneAndFreezeJson(value, path = "$", seen = new Set()) {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			fail("INVALID_MANIFEST_METADATA", `Non-finite number at ${path}`, {
				path,
			});
		return Object.is(value, -0) ? 0 : value;
	}
	if (Array.isArray(value)) {
		if (seen.has(value))
			fail("INVALID_MANIFEST_METADATA", `Cyclic value at ${path}`, { path });
		seen.add(value);
		const copy = value.map((item, index) =>
			cloneAndFreezeJson(item, `${path}[${index}]`, seen),
		);
		seen.delete(value);
		return Object.freeze(copy);
	}
	if (!isPlainRecord(value))
		fail(
			"INVALID_MANIFEST_METADATA",
			`Only JSON-compatible plain objects are allowed at ${path}`,
			{ path },
		);
	if (seen.has(value))
		fail("INVALID_MANIFEST_METADATA", `Cyclic value at ${path}`, { path });
	seen.add(value);
	const copy = Object.create(null);
	for (const key of Object.keys(value).sort()) {
		if (["__proto__", "prototype", "constructor"].includes(key)) {
			fail("INVALID_MANIFEST_METADATA", `Unsafe object key at ${path}.${key}`, {
				path,
				key,
			});
		}
		if (value[key] !== undefined)
			copy[key] = cloneAndFreezeJson(value[key], `${path}.${key}`, seen);
	}
	seen.delete(value);
	return Object.freeze(copy);
}

function normalizeValidator(manifest, validatorKey, schemaKey, label) {
	const validator = manifest[validatorKey];
	const schema = manifest[schemaKey];
	if (validator !== undefined && schema !== undefined) {
		fail(
			"AMBIGUOUS_VALIDATOR",
			`${label} must define either ${validatorKey} or ${schemaKey}, not both`,
		);
	}
	if (validator !== undefined) {
		const supported =
			typeof validator === "function" ||
			typeof validator?.safeParse === "function" ||
			typeof validator?.parse === "function";
		if (!supported)
			fail("INVALID_VALIDATOR", `${validatorKey} is not a supported validator`);
		return { validator, schema: undefined };
	}
	if (schema === undefined)
		fail("MISSING_ACTION_SCHEMA", `${schemaKey} is required`);
	assertPlainRecord(
		schema,
		"INVALID_SCHEMA",
		`${schemaKey} must be a JSON Schema object`,
	);
	const frozenSchema = cloneAndFreezeJson(schema, schemaKey);
	return {
		schema: frozenSchema,
		validator(value) {
			return validateSchema(frozenSchema, value);
		},
	};
}

function normalizePermissions(value) {
	if (!Array.isArray(value) || value.length === 0) {
		fail(
			"INVALID_ACTION_PERMISSIONS",
			"At least one explicit action permission is required",
		);
	}
	const permissions = [];
	const seen = new Set();
	for (const raw of value) {
		const permission = normalizeString(raw, "manifest.permissions[]", {
			max: 128,
			pattern: PERMISSION_PATTERN,
		});
		if (!seen.has(permission)) {
			seen.add(permission);
			permissions.push(permission);
		}
	}
	return Object.freeze(permissions);
}

function normalizeInteger(value, field, minimum, maximum, fallback) {
	const candidate = value ?? fallback;
	if (
		!Number.isInteger(candidate) ||
		candidate < minimum ||
		candidate > maximum
	) {
		fail(
			"INVALID_MANIFEST",
			`${field} must be an integer from ${minimum} to ${maximum}`,
			{ field },
		);
	}
	return candidate;
}

function normalizeManifest(manifestInput, executorInput) {
	const source = assertPlainRecord(
		manifestInput,
		"INVALID_MANIFEST",
		"Action manifest must be a plain object",
	);
	const id = normalizeString(source.id ?? source.actionId, "manifest.id", {
		max: 128,
		pattern: ACTION_ID_PATTERN,
	});
	const version = normalizeString(source.version ?? "1", "manifest.version", {
		max: 64,
		pattern: VERSION_PATTERN,
	});

	const rawRisk = normalizeString(
		source.risk ?? source.riskLevel ?? "MEDIUM",
		"manifest.risk",
		{ max: 32 },
	).toUpperCase();
	const risk = RISK_ALIASES[rawRisk] ?? rawRisk;
	if (!ALLOWED_RISKS.has(risk))
		fail("INVALID_RISK", `Unsupported action risk ${rawRisk}`, {
			risk: rawRisk,
		});

	const mutating =
		typeof source.mutating === "boolean"
			? source.mutating
			: source.readOnly === true || rawRisk === "READ"
				? false
				: true;
	if (source.readOnly === true && source.mutating === true) {
		fail("INVALID_MANIFEST", "readOnly and mutating cannot both be true");
	}

	const rawIdempotency = normalizeString(
		source.idempotency ?? (mutating ? "KEYED" : "NONE"),
		"manifest.idempotency",
		{ max: 32 },
	).toUpperCase();
	const idempotency = IDEMPOTENCY_ALIASES[rawIdempotency] ?? rawIdempotency;
	if (!ALLOWED_IDEMPOTENCY.has(idempotency)) {
		fail(
			"INVALID_IDEMPOTENCY_POLICY",
			`Unsupported idempotency mode ${rawIdempotency}`,
			{ idempotency: rawIdempotency },
		);
	}
	if (mutating && idempotency === "NONE") {
		fail(
			"UNSAFE_IDEMPOTENCY_POLICY",
			"Mutating actions must use KEYED or INHERENT idempotency",
		);
	}

	const permissions = normalizePermissions(
		source.permissions ?? (source.permission ? [source.permission] : undefined),
	);
	const timeoutMs = normalizeInteger(
		source.timeoutMs,
		"manifest.timeoutMs",
		1,
		120_000,
		15_000,
	);
	const retrySource =
		source.retry === undefined
			? {}
			: assertPlainRecord(
					source.retry,
					"INVALID_MANIFEST",
					"manifest.retry must be a plain object",
				);
	const attempts = normalizeInteger(
		retrySource.attempts,
		"manifest.retry.attempts",
		1,
		5,
		1,
	);
	const baseDelayMs = normalizeInteger(
		retrySource.baseDelayMs,
		"manifest.retry.baseDelayMs",
		0,
		5_000,
		100,
	);
	const retrySafe = !mutating || source.retrySafe === true;
	if (attempts > 1 && !retrySafe) {
		fail(
			"UNSAFE_RETRY_POLICY",
			"A mutating action may request multiple attempts only when retrySafe is explicitly true",
		);
	}
	if (attempts > 1 && idempotency === "NONE") {
		fail("UNSAFE_RETRY_POLICY", "Retrying an action requires idempotency");
	}

	const input = normalizeValidator(
		source,
		"inputValidator",
		"inputSchema",
		"Action input",
	);
	const output = normalizeValidator(
		source,
		"outputValidator",
		"outputSchema",
		"Action output",
	);
	const executor = executorInput ?? source.executor ?? source.execute;
	if (typeof executor !== "function")
		fail("INVALID_EXECUTOR", "Action executor must be a function");
	if (
		source.businessValidator !== undefined &&
		typeof source.businessValidator !== "function"
	) {
		fail("INVALID_BUSINESS_VALIDATOR", "businessValidator must be a function");
	}

	const manifest = Object.freeze({
		id,
		version,
		title:
			source.title === undefined
				? undefined
				: normalizeString(source.title, "manifest.title", { max: 160 }),
		description:
			source.description === undefined
				? undefined
				: normalizeString(source.description, "manifest.description", {
						max: 2_000,
					}),
		risk,
		mutating,
		readOnly: !mutating,
		idempotency,
		permissions,
		timeoutMs,
		retrySafe,
		retry: Object.freeze({ attempts, baseDelayMs }),
		inputSchema: input.schema,
		outputSchema: output.schema,
		inputValidator: input.validator,
		outputValidator: output.validator,
		businessValidator: source.businessValidator,
		metadata:
			source.metadata === undefined
				? undefined
				: cloneAndFreezeJson(source.metadata, "manifest.metadata"),
	});

	return Object.freeze({ manifest, executor });
}

function validateOptions(options) {
	if (options === undefined) return {};
	const source = assertPlainRecord(
		options,
		"INVALID_REGISTRY_OPTIONS",
		"Action registry options must be a plain object",
	);
	const unknown = Object.keys(source).filter(
		(key) => !ALLOWED_OPTION_KEYS.has(key),
	);
	if (unknown.length > 0) {
		fail(
			"LEGACY_EXECUTION_OPTIONS_FORBIDDEN",
			"The action registry is a catalog only; execution state, approvals and clocks belong to the governed runtime",
			{ unknownOptions: unknown.sort() },
		);
	}
	return source;
}

export function createActionRegistry(options) {
	const { entries = [] } = validateOptions(options);
	if (!Array.isArray(entries))
		fail("INVALID_REGISTRY_OPTIONS", "entries must be an array");

	const actions = new Map();
	let api;

	function register(manifest, executor) {
		const entry = normalizeManifest(manifest, executor);
		if (actions.has(entry.manifest.id)) {
			fail("DUPLICATE_ACTION", "Action is already registered", {
				id: entry.manifest.id,
			});
		}
		actions.set(entry.manifest.id, entry);
		return api;
	}

	api = Object.freeze({
		register,
		registerMany(items) {
			if (!Array.isArray(items))
				fail("INVALID_REGISTRY_ENTRIES", "registerMany expects an array");
			for (const item of items) {
				if (Array.isArray(item)) register(item[0], item[1]);
				else register(item?.manifest ?? item, item?.executor);
			}
			return api;
		},
		get(actionId) {
			return actions.get(actionId);
		},
		resolve(actionId) {
			return actions.get(actionId);
		},
		getAction(actionId) {
			return actions.get(actionId);
		},
		has(actionId) {
			return actions.has(actionId);
		},
		list() {
			return Object.freeze(
				[...actions.values()]
					.map((entry) => entry.manifest)
					.sort((left, right) => left.id.localeCompare(right.id)),
			);
		},
		get size() {
			return actions.size;
		},
	});

	api.registerMany(entries);
	return api;
}

export const createActionCatalog = createActionRegistry;
