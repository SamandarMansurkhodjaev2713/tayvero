import { createHash } from "node:crypto";
import { fail } from "./errors.mjs";

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/;

function dataDescriptor(value, key, path) {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || descriptor.get || descriptor.set || !("value" in descriptor)) {
		fail(
			"UNSAFE_PAYLOAD_PROPERTY",
			`Command payload property ${path} must be a data property`,
			{ path },
		);
	}
	return descriptor;
}

function enterContainer(value, seen) {
	if (seen.has(value)) {
		fail("CYCLIC_PAYLOAD", "Command payload contains a cycle");
	}
	seen.add(value);
}

function normalizeArray(value, seen, path) {
	enterContainer(value, seen);
	try {
		const lengthDescriptor = dataDescriptor(value, "length", `${path}.length`);
		const length = lengthDescriptor.value;
		if (!Number.isSafeInteger(length) || length < 0) {
			fail("UNSAFE_PAYLOAD_ARRAY", "Command payload array length is invalid", {
				path,
			});
		}

		const allowedKeys = new Set(["length"]);
		for (let index = 0; index < length; index += 1) {
			allowedKeys.add(String(index));
		}
		for (const key of Reflect.ownKeys(value)) {
			if (typeof key !== "string") {
				fail(
					"UNSAFE_PAYLOAD_PROPERTY",
					"Command payload arrays cannot contain symbol properties",
					{ path },
				);
			}
			if (!allowedKeys.has(key) || (key !== "length" && !ARRAY_INDEX.test(key))) {
				fail(
					"UNSAFE_PAYLOAD_PROPERTY",
					`Command payload array contains unsupported property ${path}.${key}`,
					{ path: `${path}.${key}` },
				);
			}
		}

		const result = [];
		for (let index = 0; index < length; index += 1) {
			const key = String(index);
			const descriptor = dataDescriptor(value, key, `${path}[${index}]`);
			if (!descriptor.enumerable) {
				fail(
					"UNSAFE_PAYLOAD_PROPERTY",
					`Command payload array item ${path}[${index}] must be enumerable`,
					{ path: `${path}[${index}]` },
				);
			}
			result.push(normalize(descriptor.value, seen, `${path}[${index}]`));
		}
		return result;
	} finally {
		seen.delete(value);
	}
}

function normalizeObject(value, seen, path) {
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		fail(
			"UNSAFE_PAYLOAD_OBJECT",
			"Command payload must contain only plain objects",
			{ path },
		);
	}
	enterContainer(value, seen);
	try {
		const keys = [];
		for (const key of Reflect.ownKeys(value)) {
			if (typeof key !== "string") {
				fail(
					"UNSAFE_PAYLOAD_PROPERTY",
					"Command payload objects cannot contain symbol properties",
					{ path },
				);
			}
			if (FORBIDDEN_KEYS.has(key)) {
				fail("UNSAFE_PAYLOAD_KEY", "Command payload contains an unsafe key", {
					key,
					path: `${path}.${key}`,
				});
			}
			const descriptor = dataDescriptor(value, key, `${path}.${key}`);
			if (!descriptor.enumerable) {
				fail(
					"UNSAFE_PAYLOAD_PROPERTY",
					`Command payload property ${path}.${key} must be enumerable`,
					{ path: `${path}.${key}` },
				);
			}
			keys.push(key);
		}

		const output = Object.create(null);
		for (const key of keys.sort()) {
			const descriptor = dataDescriptor(value, key, `${path}.${key}`);
			output[key] = normalize(descriptor.value, seen, `${path}.${key}`);
		}
		return output;
	} finally {
		seen.delete(value);
	}
}

function normalize(value, seen, path) {
	if (value === null || typeof value === "string" || typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			fail(
				"NON_FINITE_NUMBER",
				"Command payload contains a non-finite number",
				{ path },
			);
		}
		return value;
	}
	if (typeof value === "bigint") return { $bigint: value.toString() };
	if (typeof value !== "object") {
		fail(
			"UNSUPPORTED_PAYLOAD_VALUE",
			"Command payload contains an unsupported value type",
			{ path, type: typeof value },
		);
	}

	if (Object.getPrototypeOf(value) === Date.prototype) {
		const timestamp = Date.prototype.getTime.call(value);
		if (Number.isNaN(timestamp)) {
			fail("INVALID_DATE", "Command payload contains an invalid date", { path });
		}
		return { $date: new Date(timestamp).toISOString() };
	}
	if (Array.isArray(value)) return normalizeArray(value, seen, path);
	return normalizeObject(value, seen, path);
}

export function canonicalJson(value) {
	return JSON.stringify(normalize(value, new WeakSet(), "$"));
}

export function payloadHash(value) {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
