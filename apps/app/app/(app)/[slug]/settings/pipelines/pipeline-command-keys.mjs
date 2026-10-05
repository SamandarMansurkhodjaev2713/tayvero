const SAFE_SCOPE = /^[A-Za-z0-9_.:-]{1,120}$/;
const DEFAULT_CAPACITY = 64;

function assertText(value, label, maxLength) {
	if (
		typeof value !== "string" ||
		value.length < 1 ||
		value.length > maxLength
	) {
		throw new TypeError(`${label} must be a non-empty bounded string.`);
	}
	return value;
}

function defaultKeyFactory(scope) {
	if (
		!globalThis.crypto ||
		typeof globalThis.crypto.randomUUID !== "function"
	) {
		throw new Error("Secure browser UUID generation is unavailable.");
	}
	return `${scope}:${globalThis.crypto.randomUUID()}`;
}

export function createPipelineCommandKeyStore({
	capacity = DEFAULT_CAPACITY,
	keyFactory = defaultKeyFactory,
} = {}) {
	if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1_000) {
		throw new TypeError("Command-key capacity must be between 1 and 1000.");
	}
	if (typeof keyFactory !== "function") {
		throw new TypeError("Command-key factory must be a function.");
	}
	const entries = new Map();

	function get(scopeInput, fingerprintInput) {
		const scope = assertText(scopeInput, "Command scope", 120);
		if (!SAFE_SCOPE.test(scope)) {
			throw new TypeError("Command scope contains unsupported characters.");
		}
		const fingerprint = assertText(
			fingerprintInput,
			"Command fingerprint",
			1_000_000,
		);
		const existing = entries.get(scope);
		if (existing?.fingerprint === fingerprint) return existing.key;

		const key = keyFactory(scope);
		if (
			typeof key !== "string" ||
			key.length < 8 ||
			key.length > 200 ||
			!/^[A-Za-z0-9_.:-]+$/.test(key)
		) {
			throw new Error(
				"Command-key factory returned an invalid idempotency key.",
			);
		}
		entries.delete(scope);
		entries.set(scope, Object.freeze({ fingerprint, key }));
		while (entries.size > capacity) {
			const oldest = entries.keys().next().value;
			if (oldest === undefined) break;
			entries.delete(oldest);
		}
		return key;
	}

	function clear(scopeInput, expectedKey) {
		const scope = assertText(scopeInput, "Command scope", 120);
		const existing = entries.get(scope);
		if (!existing) return false;
		if (expectedKey !== undefined && existing.key !== expectedKey) return false;
		return entries.delete(scope);
	}

	return Object.freeze({
		get,
		clear,
		size: () => entries.size,
	});
}
