import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
	compileOpenApiTools,
	executeHttpAction,
	InMemoryReplayStore,
	IntegrationRuntimeError,
	isBlockedIp,
	resolveSafeTarget,
	signWebhook,
	verifyWebhook,
} from "../src/index.mjs";

function code(fn, expected) {
	return assert.rejects(
		fn,
		(error) =>
			error instanceof IntegrationRuntimeError && error.code === expected,
	);
}
test("blocks private, loopback, link-local, metadata, documentation and multicast IP ranges", () => {
	for (const ip of [
		"127.0.0.1",
		"10.0.0.1",
		"169.254.169.254",
		"172.16.0.1",
		"192.168.1.1",
		"198.51.100.2",
		"224.0.0.1",
		"::1",
		"fd00::1",
		"fe80::1",
		"2001:db8::1",
	])
		assert.equal(isBlockedIp(ip), true);
	assert.equal(isBlockedIp("8.8.8.8"), false);
});
test("rejects URL credentials and DNS rebinding to a private address", async () => {
	await code(
		() => resolveSafeTarget("https://user:pass@example.com"),
		"URL_CREDENTIALS",
	);
	await code(
		() =>
			resolveSafeTarget("https://example.com", {
				resolve: async () => [{ address: "127.0.0.1", family: 4 }],
			}),
		"BLOCKED_ADDRESS",
	);
});
test("enforces connector host allowlists", async () => {
	await code(
		() =>
			resolveSafeTarget("https://evil.example", {
				allowHosts: ["api.example.com"],
				resolve: async () => [{ address: "8.8.8.8", family: 4 }],
			}),
		"HOST_NOT_ALLOWED",
	);
});
test("executes a pinned bounded request and parses JSON", async (t) => {
	const server = http.createServer((req, res) => {
		res.setHeader("content-type", "application/json");
		res.end(
			JSON.stringify({ ok: true, idempotency: req.headers["idempotency-key"] }),
		);
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	t.after(() => server.close());
	const port = server.address().port;
	const result = await executeHttpAction(
		{
			method: "POST",
			url: `http://test.local:${port}/run`,
			idempotencyKey: "operation-0001",
			body: { x: 1 },
		},
		{
			maxAttempts: 1,
			networkPolicy: {
				allowPrivateForTest: true,
				allowedPorts: [port],
				resolve: async () => [{ address: "127.0.0.1", family: 4 }],
			},
		},
	);
	assert.equal(result.status, 200);
	assert.deepEqual(result.data, { ok: true, idempotency: "operation-0001" });
});
test("rejects mutation retry without idempotency", async () =>
	code(
		() =>
			executeHttpAction(
				{ method: "POST", url: "https://example.com", body: {} },
				{
					maxAttempts: 2,
					networkPolicy: {
						resolve: async () => [{ address: "8.8.8.8", family: 4 }],
					},
				},
			),
		"RETRY_REQUIRES_IDEMPOTENCY",
	));
test("rejects redirect to a private destination", async (t) => {
	const server = http.createServer((_req, res) => {
		res.statusCode = 302;
		res.setHeader("location", "http://127.0.0.1/private");
		res.end();
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	t.after(() => server.close());
	const port = server.address().port;
	await code(
		() =>
			executeHttpAction(
				{ method: "GET", url: `http://safe.test:${port}/start` },
				{
					maxAttempts: 1,
					networkPolicy: {
						allowedPorts: [port, 80],
						allowPrivateForTest: true,
						denyHosts: ["127.0.0.1"],
						resolve: async () => [{ address: "127.0.0.1", family: 4 }],
					},
				},
			),
		"BLOCKED_HOST",
	);
});
test("verifies HMAC webhooks and rejects replay", async () => {
	const secret = "x".repeat(32),
		body = Buffer.from('{"ok":true}'),
		timestamp = 1700000000,
		header = signWebhook({ secret, timestamp, body }),
		store = new InMemoryReplayStore();
	await verifyWebhook({
		secret,
		signatureHeader: header,
		body,
		now: timestamp,
		replayStore: store,
	});
	await code(
		() =>
			verifyWebhook({
				secret,
				signatureHeader: header,
				body,
				now: timestamp,
				replayStore: store,
			}),
		"WEBHOOK_REPLAY",
	);
});
test("rejects tampered webhook body", async () => {
	const secret = "x".repeat(32),
		timestamp = 1700000000,
		header = signWebhook({ secret, timestamp, body: "a" });
	await code(
		() =>
			verifyWebhook({
				secret,
				signatureHeader: header,
				body: "b",
				now: timestamp,
			}),
		"WEBHOOK_SIGNATURE",
	);
});
test("compiles bounded OpenAPI operations and classifies risk", () => {
	const tools = compileOpenApiTools({
		openapi: "3.1.0",
		servers: [{ url: "https://api.example.com" }],
		paths: {
			"/orders": {
				get: { operationId: "orders.list", summary: "List" },
				post: {
					operationId: "orders.create",
					requestBody: {
						content: { "application/json": { schema: { type: "object" } } },
					},
				},
			},
			"/orders/{id}": { delete: { operationId: "orders.delete" } },
		},
	});
	assert.deepEqual(
		tools.map((tool) => tool.risk),
		["READ", "WRITE", "HIGH"],
	);
});
test("rejects external OpenAPI references", () =>
	assert.throws(
		() =>
			compileOpenApiTools({
				openapi: "3.1.0",
				servers: [{ url: "https://api.example.com" }],
				paths: {
					"/x": {
						post: {
							operationId: "x.create",
							requestBody: {
								content: {
									"application/json": {
										schema: { $ref: "https://evil/schema.json" },
									},
								},
							},
						},
					},
				},
			}),
		(error) => error.code === "EXTERNAL_OPENAPI_REF",
	));

test("rejects malformed resolver results before opening a socket", async () => {
	await code(
		() =>
			executeHttpAction(
				{ method: "GET", url: "https://example.test" },
				{
					maxAttempts: 1,
					networkPolicy: {
						resolve: async () => [{ address: undefined, family: 4 }],
					},
				},
			),
		"INVALID_RESOLVED_ADDRESS",
	);
});

test("validates the retry-delay boundary", async () => {
	await code(
		() =>
			executeHttpAction(
				{ method: "GET", url: "https://example.test" },
				{ maxAttempts: 1, maxRetryDelayMs: Number.POSITIVE_INFINITY },
			),
		"INVALID_LIMIT",
	);
});

test("enforces a total request deadline even while response bytes keep arriving", async (t) => {
	const server = http.createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/plain" });
		const interval = setInterval(() => response.write("x"), 20);
		response.on("close", () => clearInterval(interval));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => server.close());
	const { port } = server.address();

	await code(
		() =>
			executeHttpAction(
				{ method: "GET", url: `http://deadline.test:${port}/stream` },
				{
					timeoutMs: 100,
					maxAttempts: 1,
					networkPolicy: {
						allowPrivateForTest: true,
						allowedPorts: [port],
						resolve: async () => [{ address: "127.0.0.1", family: 4 }],
					},
				},
			),
		"REQUEST_TIMEOUT",
	);
});
