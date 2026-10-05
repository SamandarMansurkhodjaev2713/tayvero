import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { fail, IntegrationRuntimeError } from "./errors.mjs";
import { resolveSafeTarget } from "./network-policy.mjs";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const FORBIDDEN_HEADERS = new Set([
	"host",
	"connection",
	"transfer-encoding",
	"content-length",
	"proxy-authorization",
	"proxy-authenticate",
	"upgrade",
	"te",
	"trailer",
]);

function normalizeHeaders(input = {}) {
	const normalized = Object.create(null);

	for (const [name, value] of Object.entries(input)) {
		const key = name.toLowerCase();

		if (FORBIDDEN_HEADERS.has(key)) {
			fail("FORBIDDEN_HEADER", "Header is controlled by the runtime", { name });
		}
		if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name)) {
			fail("INVALID_HEADER", "Header name is invalid", { name });
		}
		if (typeof value !== "string" || /[\r\n]/.test(value)) {
			fail("INVALID_HEADER_VALUE", "Header value is invalid", { name });
		}

		normalized[key] = value;
	}

	// Transparent compression can otherwise let a small compressed response expand
	// beyond the configured in-memory response boundary after decompression.
	normalized["accept-encoding"] = "identity";
	return normalized;
}

function parseRetryAfter(value, maxMs) {
	if (!value) return null;

	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.min(maxMs, Math.floor(seconds * 1_000));
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return Math.max(0, Math.min(maxMs, date.getTime() - Date.now()));
}

function validatePinnedAddress(address) {
	if (
		!address ||
		typeof address.address !== "string" ||
		![4, 6].includes(address.family) ||
		isIP(address.address) !== address.family
	) {
		fail("INVALID_RESOLVED_ADDRESS", "Resolved target address is invalid");
	}

	return Object.freeze({ address: address.address, family: address.family });
}

function createPinnedLookup(address) {
	const pinned = validatePinnedAddress(address);

	return function lookup(_hostname, options, callback) {
		const resolvedOptions =
			typeof options === "object" && options !== null ? options : {};
		const resolvedCallback = typeof options === "function" ? options : callback;

		if (typeof resolvedCallback !== "function") {
			throw new TypeError("DNS lookup callback is required");
		}

		// Node 22 enables auto-family selection and calls a custom lookup with
		// { all: true }. In that mode the callback must receive an address array;
		// returning the legacy scalar tuple makes node:net observe `undefined`.
		if (resolvedOptions.all === true) {
			resolvedCallback(null, [
				{ address: pinned.address, family: pinned.family },
			]);
			return;
		}

		resolvedCallback(null, pinned.address, pinned.family);
	};
}

function serializeBody(body) {
	if (body == null) return null;
	if (typeof body === "string" || Buffer.isBuffer(body)) {
		return Buffer.from(body);
	}

	try {
		return Buffer.from(JSON.stringify(body));
	} catch {
		fail("INVALID_REQUEST_BODY", "Request body is not JSON serializable");
	}
}

async function executeOnce(target, request, options) {
	const body = serializeBody(request.body);
	if (body && body.length > options.maxRequestBytes) {
		fail("REQUEST_TOO_LARGE", "Request body exceeds limit");
	}

	const address = validatePinnedAddress(target.addresses?.[0]);
	const client = target.url.protocol === "https:" ? https : http;

	return new Promise((resolve, reject) => {
		let settled = false;
		let totalTimeout;

		const settle = (callback, value) => {
			if (settled) return;
			settled = true;
			if (totalTimeout) clearTimeout(totalTimeout);
			callback(value);
		};

		const requestOptions = {
			signal: options.signal,
			protocol: target.url.protocol,
			hostname: target.hostname,
			port: target.port,
			path: `${target.url.pathname}${target.url.search}`,
			method: request.method,
			headers: {
				...request.headers,
				...(body ? { "content-length": String(body.length) } : {}),
			},
			servername: target.hostname,
			lookup: createPinnedLookup(address),
			// Disabling family auto-selection is defence in depth. The lookup still
			// supports `{ all: true }` for Node versions/agents that request it.
			autoSelectFamily: false,
		};

		const req = client.request(requestOptions, (response) => {
			const chunks = [];
			let size = 0;

			response.on("data", (chunk) => {
				size += chunk.length;
				if (size > options.maxResponseBytes) {
					const error = new IntegrationRuntimeError(
						"RESPONSE_TOO_LARGE",
						"Response body exceeds limit",
					);
					settle(reject, error);
					req.destroy(error);
					return;
				}
				chunks.push(chunk);
			});

			response.on("aborted", () => {
				settle(
					reject,
					new IntegrationRuntimeError(
						"ECONNRESET",
						"Remote response was aborted",
					),
				);
			});

			response.on("error", (error) => settle(reject, error));
			response.on("end", () => {
				settle(resolve, {
					status: response.statusCode ?? 0,
					headers: response.headers,
					body: Buffer.concat(chunks),
				});
			});
		});

		// `ClientRequest#setTimeout` is an inactivity timeout, not a complete
		// operation deadline. Keep both so slow trickle responses cannot run forever.
		req.setTimeout(options.timeoutMs, () => {
			const error = new IntegrationRuntimeError(
				"REQUEST_TIMEOUT",
				"Request inactivity timeout exceeded",
			);
			settle(reject, error);
			req.destroy(error);
		});

		totalTimeout = setTimeout(() => {
			const error = new IntegrationRuntimeError(
				"REQUEST_TIMEOUT",
				"Request deadline exceeded",
			);
			settle(reject, error);
			req.destroy(error);
		}, options.timeoutMs);
		totalTimeout.unref?.();

		req.on("error", (error) => settle(reject, error));

		if (body) req.write(body);
		req.end();
	});
}

function validateLimit(value, name, min, max) {
	if (!Number.isSafeInteger(value) || value < min || value > max) {
		fail("INVALID_LIMIT", `${name} is invalid`);
	}
}

async function runHttpAction(request, options, signal) {
	const method = String(request?.method ?? "GET").toUpperCase();
	if (!METHODS.has(method)) {
		fail("METHOD_NOT_ALLOWED", "Unsupported HTTP method", { method });
	}

	const timeoutMs = options.timeoutMs ?? 10_000;
	const maxResponseBytes = options.maxResponseBytes ?? 2_000_000;
	const maxRequestBytes = options.maxRequestBytes ?? 1_000_000;
	const maxRedirects = options.maxRedirects ?? 3;
	const maxAttempts = options.maxAttempts ?? 3;
	const maxRetryDelayMs = options.maxRetryDelayMs ?? 10_000;

	validateLimit(timeoutMs, "timeoutMs", 100, 120_000);
	validateLimit(maxResponseBytes, "maxResponseBytes", 1, 50_000_000);
	validateLimit(maxRequestBytes, "maxRequestBytes", 0, 50_000_000);
	validateLimit(maxRedirects, "maxRedirects", 0, 10);
	validateLimit(maxAttempts, "maxAttempts", 1, 8);
	validateLimit(maxRetryDelayMs, "maxRetryDelayMs", 0, 120_000);

	const requestHeaders = normalizeHeaders(request?.headers);
	if (request?.idempotencyKey) {
		if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(request.idempotencyKey)) {
			fail("INVALID_IDEMPOTENCY_KEY", "Invalid idempotency key");
		}
		requestHeaders["idempotency-key"] = request.idempotencyKey;
	}

	const mutation = method !== "GET";
	if (mutation && maxAttempts > 1 && !request?.idempotencyKey) {
		fail(
			"RETRY_REQUIRES_IDEMPOTENCY",
			"Mutation retry requires an idempotency key",
		);
	}

	if (mutation && maxAttempts > 1 && options.supportsIdempotency !== true) {
		fail(
			"RETRY_CAPABILITY_REQUIRED",
			"Mutation retries require an explicit provider idempotency capability",
		);
	}
	let currentUrl = request?.url;
	let redirects = 0;
	let lastError;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			let target = await bounded(
				resolveSafeTarget(currentUrl, options.networkPolicy),
				signal,
			);

			while (true) {
				const response = await executeOnce(
					target,
					{ method, headers: requestHeaders, body: request?.body },
					{ timeoutMs, maxResponseBytes, maxRequestBytes, signal },
				);

				if (
					[301, 302, 303, 307, 308].includes(response.status) &&
					response.headers.location
				) {
					if (redirects >= maxRedirects) {
						fail("TOO_MANY_REDIRECTS", "Redirect limit exceeded");
					}

					const nextUrl = new URL(
						response.headers.location,
						target.url,
					).toString();
					const nextTarget = await bounded(
						resolveSafeTarget(nextUrl, options.networkPolicy),
						signal,
					);
					if (nextTarget.url.origin !== target.url.origin) {
						fail(
							"CROSS_ORIGIN_REDIRECT",
							"Cross-origin redirects are forbidden; credentials and request bodies must not leave the approved origin",
						);
					}
					if (mutation && [301, 302, 303].includes(response.status)) {
						fail(
							"UNSAFE_MUTATION_REDIRECT",
							"Mutation redirects with ambiguous method semantics are forbidden",
						);
					}
					target = nextTarget;
					currentUrl = nextUrl;
					redirects += 1;
					continue;
				}

				if (RETRY_STATUS.has(response.status) && attempt < maxAttempts) {
					const wait =
						parseRetryAfter(response.headers["retry-after"], maxRetryDelayMs) ??
						Math.min(maxRetryDelayMs, 100 * 2 ** (attempt - 1));
					await sleep(wait, undefined, { signal });
					break;
				}

				const contentType = String(
					response.headers["content-type"] ?? "",
				).toLowerCase();
				let data = response.body.toString("utf8");

				if (contentType.includes("application/json") && data) {
					try {
						data = JSON.parse(data);
					} catch {
						fail(
							"INVALID_JSON_RESPONSE",
							"Remote endpoint returned malformed JSON",
						);
					}
				}

				return Object.freeze({
					status: response.status,
					headers: Object.freeze({ ...response.headers }),
					data,
					attempts: attempt,
					finalUrl: target.url.toString(),
				});
			}
		} catch (error) {
			if (signal.aborted) throw signal.reason;
			lastError = error;
			const retryable = [
				"REQUEST_TIMEOUT",
				"ECONNRESET",
				"EAI_AGAIN",
				"ECONNREFUSED",
			].includes(error?.code);

			if (attempt >= maxAttempts || !retryable) throw error;
			await sleep(
				Math.min(maxRetryDelayMs, 100 * 2 ** (attempt - 1)),
				undefined,
				{ signal },
			);
		}
	}

	throw lastError;
}

// A single operation deadline covers DNS, redirects, sockets AND retry waits.
// Promise.race alone would leave a live HTTP mutation running after cancellation.
function bounded(promise, signal) {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		const abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
		Promise.resolve(promise)
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", abort));
	});
}
export async function executeHttpAction(request, options = {}) {
	const totalTimeoutMs = options.totalTimeoutMs ?? options.timeoutMs ?? 10000;
	validateLimit(totalTimeoutMs, "totalTimeoutMs", 100, 120000);
	const external = options.signal;
	if (
		external &&
		(typeof external.aborted !== "boolean" ||
			typeof external.addEventListener !== "function" ||
			typeof external.removeEventListener !== "function")
	) {
		fail("INVALID_ABORT_SIGNAL", "signal must implement AbortSignal");
	}
	const controller = new AbortController();
	const cancel = () =>
		controller.abort(
			new IntegrationRuntimeError("REQUEST_CANCELLED", "Request cancelled"),
		);
	if (external?.aborted) {
		cancel();
		throw controller.signal.reason;
	}
	external?.addEventListener("abort", cancel, { once: true });
	const timer = setTimeout(
		() =>
			controller.abort(
				new IntegrationRuntimeError(
					"REQUEST_TIMEOUT",
					"Total operation deadline exceeded",
				),
			),
		totalTimeoutMs,
	);
	try {
		return await bounded(
			runHttpAction(request, options, controller.signal),
			controller.signal,
		);
	} finally {
		clearTimeout(timer);
		external?.removeEventListener("abort", cancel);
	}
}
