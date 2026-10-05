import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { createOperationsBodyGuard } from "../src/trpc/operations-body-guard.mjs";
function h(guard, options = {}) { const req = new PassThrough(); Object.assign(req, { url: "/migrations.upload", method: "POST", headers: { "content-type": "application/json" }, ...options }); const res = new EventEmitter(); Object.assign(res, { statusCode: 200, headersSent: false, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; this.emit("finish"); } }); let called = 0; guard(req, res, () => called++); return { req, res, get called() { return called; } }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
test("bounded operator body is preserved as raw JSON text for the tRPC reader", async () => { const f = h(createOperationsBodyGuard()); f.req.end('{"0":{"json":{"filename":"x.csv"}}}'); await tick(); assert.equal(f.called, 1); assert.equal(f.req.body, '{"0":{"json":{"filename":"x.csv"}}}'); f.res.end(); });
test("oversized declared and chunked bodies are rejected before tRPC", async () => { const g = createOperationsBodyGuard({ maxBytes: 1024 }); const a = h(g, { headers: { "content-type": "application/json", "content-length": "5000" } }); assert.equal(a.res.statusCode, 413); const b = h(g); b.req.end(Buffer.alloc(1025)); await tick(); assert.equal(b.res.statusCode, 413); assert.equal(b.called, 0); });
test("compressed bodies, non-JSON CSRF-like posts and invalid UTF-8 are rejected", async () => { for (const headers of [{ "content-type": "application/json", "content-encoding": "gzip" }, { "content-type": "text/plain" }]) {
    const f = h(createOperationsBodyGuard(), { headers });
    assert.equal(f.res.statusCode, 415);
    assert.equal(f.called, 0);
} const f = h(createOperationsBodyGuard()); f.req.end(Buffer.from([0xff])); await tick(); assert.equal(f.res.statusCode, 400); });
test("unrelated CRM and webhook paths are not parsed or altered", () => { for (const url of ["/contacts.create", "/webhook", "/migrationsNotActually.upload"]) {
    const f = h(createOperationsBodyGuard(), { url });
    assert.equal(f.called, 1);
    assert.equal("body" in f.req, false);
} });
test("mixed batches and encoded procedure paths receive the same limit", async () => { const f = h(createOperationsBodyGuard({ maxBytes: 1024 }), { url: "/contacts.list,migrations%2Eupload?batch=1" }); f.req.end(Buffer.alloc(1025)); await tick(); assert.equal(f.res.statusCode, 413); assert.equal(f.called, 0); });
test("inflight cap lasts through response completion, not just upload completion", async () => { const g = createOperationsBodyGuard({ maxConcurrent: 1 }); const a = h(g); a.req.end("{}"); await tick(); assert.equal(a.called, 1); const b = h(g); assert.equal(b.res.statusCode, 429); a.res.end(); const c = h(g); c.req.end("{}"); await tick(); assert.equal(c.called, 1); c.res.end(); });
test("timeouts and aborted uploads free the slot", async () => { const g = createOperationsBodyGuard({ maxConcurrent: 1, timeoutMs: 15 }); const a = h(g); await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(a.res.statusCode, 408); const b = h(g); b.req.emit("aborted"); assert.equal(b.res.statusCode, 400); const c = h(g); c.req.end("{}"); await tick(); assert.equal(c.called, 1); c.res.end(); });
test("real Node HTTP transport enforces streaming byte bounds on loopback", async (t) => { const g = createOperationsBodyGuard({ maxBytes: 1024 }); const server = createServer((req, res) => g(req, res, () => { res.end(String(req.body)); })); await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); t.after(() => new Promise(resolve => server.close(resolve))); const address = server.address(); const url = `http://127.0.0.1:${address.port}/migrations.upload`; const ok = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"value":1}' }); assert.equal(ok.status, 200); assert.equal(await ok.text(), '{"value":1}'); const large = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: "x".repeat(2000) }) }); assert.equal(large.status, 413); await large.text(); });
