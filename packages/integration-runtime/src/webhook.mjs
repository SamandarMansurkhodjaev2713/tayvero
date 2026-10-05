import { createHmac, timingSafeEqual } from "node:crypto";
import { fail } from "./errors.mjs";
const MAX_BODY_BYTES = 2000000;
function bytes(value) {
  if (typeof value !== "string" && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) fail("INVALID_WEBHOOK_BODY", "Verify the original raw webhook bytes, not a parsed object");
  const result = Buffer.from(value);
  if (result.length > MAX_BODY_BYTES) fail("WEBHOOK_BODY_TOO_LARGE", "Webhook body exceeds the verification limit");
  return result;
}
function validTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_SIGNATURE_HEADER", "Webhook timestamp must be a non-negative safe integer");
  return value;
}
function parse(header) {
  if (typeof header !== "string") fail("MISSING_SIGNATURE", "Signature header is required");
  if (header.length > 256) fail("INVALID_SIGNATURE_HEADER", "Signature header is too long");
  const fields = new Map();
  for (const part of header.split(",")) {
    const match = /^(t|v1)=([^=,]+)$/.exec(part.trim());
    if (!match || fields.has(match[1])) fail("INVALID_SIGNATURE_HEADER", "Signature header is malformed or has duplicate fields");
    fields.set(match[1], match[2]);
  }
  if (!/^(0|[1-9]\d{0,15})$/.test(fields.get("t") ?? "") || !/^[a-f0-9]{64}$/.test(fields.get("v1") ?? "")) fail("INVALID_SIGNATURE_HEADER", "Signature header is malformed");
  return { timestamp: validTimestamp(Number(fields.get("t"))), signature: fields.get("v1") };
}
export function signWebhook({ secret, timestamp, body }) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) fail("WEAK_WEBHOOK_SECRET", "Webhook secret must contain at least 32 bytes");
  validTimestamp(timestamp);
  const signature = createHmac("sha256", secret).update(String(timestamp)).update(".").update(bytes(body)).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}
export async function verifyWebhook({ secret, signatureHeader, body, now = Math.floor(Date.now()/1000), toleranceSeconds = 300, replayStore, replayNamespace = "webhook" }) {
  const parsed = parse(signatureHeader);
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(toleranceSeconds) || toleranceSeconds < 0 || toleranceSeconds > 3600) fail("INVALID_TIME_POLICY", "Webhook time policy is invalid");
  if (Math.abs(now - parsed.timestamp) > toleranceSeconds) fail("WEBHOOK_TIMESTAMP", "Webhook timestamp is outside tolerance");
  const expected = parse(signWebhook({ secret, timestamp: parsed.timestamp, body })).signature;
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(parsed.signature, "hex"))) fail("WEBHOOK_SIGNATURE", "Webhook signature is invalid");
  if (!replayStore || typeof replayStore.claim !== "function") fail("REPLAY_STORE_REQUIRED", "An atomic replay store is required; signature-only verification is not delivery safety");
  if (typeof replayNamespace !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(replayNamespace)) fail("INVALID_REPLAY_NAMESPACE", "A bounded tenant/connection replay namespace is required");
  const replayKey = `${replayNamespace}:${parsed.timestamp}:${parsed.signature}`;
  if ((await replayStore.claim(replayKey, parsed.timestamp + toleranceSeconds, now)) !== true) fail("WEBHOOK_REPLAY", "Webhook was already processed");
  return Object.freeze({ timestamp: parsed.timestamp, replayKey });
}
// Test/dev adapter only. Production must use an atomic durable unique insert.
export class InMemoryReplayStore {
  #keys = new Map();
  #maxEntries;
  constructor({ maxEntries = 10000 } = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) fail("INVALID_REPLAY_LIMIT", "Replay capacity is invalid");
    this.#maxEntries = maxEntries;
  }
  async claim(key, expiresAt, nowSeconds = Math.floor(Date.now()/1000)) {
    for (const [stored, expiry] of this.#keys) if (expiry < nowSeconds) this.#keys.delete(stored);
    if (this.#keys.has(key)) return false;
    if (this.#keys.size >= this.#maxEntries) fail("REPLAY_STORE_FULL", "Replay storage is full; refusing unprotected acceptance");
    this.#keys.set(key, expiresAt); return true;
  }
}
