import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { isBlockedIp, executeHttpAction, compileOpenApiTools, verifyWebhook, signWebhook, InMemoryReplayStore } from "../src/index.mjs";
const rejects = (fn, expected) => assert.rejects(fn, error => error.code === expected);
async function server(t, handler) {
    const instance = http.createServer(handler);
    await new Promise(resolve => instance.listen(0, "127.0.0.1", resolve));
    t.after(() => { instance.closeAllConnections(); instance.close(); });
    return instance.address().port;
}
const policy = ports => ({ allowPrivateForTest: true, allowedPorts: ports, resolve: async () => [{ address: "127.0.0.1", family: 4 }] });
const document = paths => ({ openapi: "3.1.0", servers: [{ url: "https://api.example.com/v1" }], paths });
test("SSRF: all mapped, expanded, reserved and transition representations are blocked", () => {
    for (const ip of ["::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "0:0:0:0:0:0:0:1", "0:0:0:0:0:0:0:0", "::ffff:192.168.1.1", "::127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001:0:1234::", "3fff::1", "240.0.0.1", "255.255.255.255", "192.88.99.1"]) {
        assert.equal(isBlockedIp(ip), true, ip);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888", "2606:4700:4700::1111"])
        assert.equal(isBlockedIp(ip), false, ip);
});
test("HTTP: cross-origin redirect cannot forward secrets or reach its destination", async (t) => {
    let received = 0;
    const target = await server(t, (_req, res) => { received++; res.end("leaked"); });
    const source = await server(t, (_req, res) => { res.writeHead(307, { location: `http://other.test:${target}/steal` }); res.end(); });
    await rejects(() => executeHttpAction({ url: `http://origin.test:${source}/`, headers: { authorization: "Bearer test-only", "x-api-key": "sensitive" } }, { maxAttempts: 1, networkPolicy: policy([source, target]) }), "CROSS_ORIGIN_REDIRECT");
    assert.equal(received, 0);
});
test("HTTP: safe same-origin GET redirect still works", async (t) => {
    const port = await server(t, (req, res) => { if (req.url === "/") {
        res.writeHead(302, { location: "/ok" });
        res.end();
    }
    else
        res.end("ok"); });
    const result = await executeHttpAction({ url: `http://same.test:${port}/` }, { maxAttempts: 1, networkPolicy: policy([port]) });
    assert.equal(result.data, "ok");
});
test("HTTP: an idempotency header alone does not prove the provider can safely retry", async () => {
    await rejects(() => executeHttpAction({ method: "POST", url: "https://example.com", idempotencyKey: "operation-00001" }, { maxAttempts: 2 }), "RETRY_CAPABILITY_REQUIRED");
});
test("HTTP: abort before dispatch performs no DNS lookup", async () => {
    const controller = new AbortController();
    controller.abort();
    let lookups = 0;
    await rejects(() => executeHttpAction({ url: "https://example.com" }, { signal: controller.signal, networkPolicy: { resolve: async () => { lookups++; return []; } } }), "REQUEST_CANCELLED");
    assert.equal(lookups, 0);
});
test("HTTP: deadline includes stalled DNS resolution", async () => {
    await rejects(() => executeHttpAction({ url: "https://example.com" }, { timeoutMs: 100, totalTimeoutMs: 100, maxAttempts: 1, networkPolicy: { resolve: () => new Promise(() => { }) } }), "REQUEST_TIMEOUT");
});
test("Webhook: replay protection must not silently disappear", async () => {
    const input = { secret: "s".repeat(32), body: "hello", timestamp: 1700000000 };
    await rejects(() => verifyWebhook({ ...input, now: input.timestamp, signatureHeader: signWebhook(input) }), "REPLAY_STORE_REQUIRED");
});
test("Webhook: ambiguous duplicate signature fields are rejected", async () => {
    const input = { secret: "s".repeat(32), body: "hello", timestamp: 1700000000 };
    await rejects(() => verifyWebhook({ ...input, now: input.timestamp, signatureHeader: `${signWebhook(input)},t=${input.timestamp}`, replayStore: new InMemoryReplayStore() }), "INVALID_SIGNATURE_HEADER");
});
test("OpenAPI: server base path is retained and schema is an immutable snapshot", () => {
    const schema = { type: "object", properties: { name: { type: "string" } } };
    const spec = document({ "/contacts": { post: { operationId: "contacts.create", requestBody: { content: { "application/json": { schema } } } } } });
    const [tool] = compileOpenApiTools(spec);
    assert.equal(tool.urlTemplate, "https://api.example.com/v1/contacts");
    schema.properties.name.type = "number";
    assert.equal(tool.inputSchema.properties.name.type, "string");
    assert.ok(Object.isFrozen(tool.inputSchema.properties));
});
test("OpenAPI: reject host-changing and traversal paths", () => {
    for (const path of ["//evil.example/action", "/../admin", "/%2e%2e/admin", "/x?token=leak", "/x#fragment", "/\\evil.example"]) {
        assert.throws(() => compileOpenApiTools(document({ [path]: { get: { operationId: "read" } } })), error => error.code === "OPENAPI_PATH", path);
    }
});
test("OpenAPI: cyclic objects are bounded failures, not stack overflows", () => {
    const spec = document({ "/x": { get: { operationId: "read" } } });
    spec.circular = spec;
    assert.throws(() => compileOpenApiTools(spec), error => error.code === "INVALID_OPENAPI_STRUCTURE");
});
