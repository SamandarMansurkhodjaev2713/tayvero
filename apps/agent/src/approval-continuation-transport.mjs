import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson, sha256Hex } from "@crm/agent-action-runtime";

const ISSUER = "tayvero-continuation",
	AUDIENCE = "tayvero-eve-exact-resume",
	MAX_BYTES = 16384;
const validId = (value) =>
	typeof value === "string" &&
	/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/.test(value);
const validHash = (value) =>
	typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function validateClaim(q) {
	if (
		!q ||
		![
			"id",
			"sessionId",
			"rootSessionId",
			"runId",
			"callId",
			"approvalId",
			"versionId",
			"requestId",
			"leaseToken",
		].every((k) => validId(q[k])) ||
		!validHash(q.payloadDigest) ||
		!["approve", "deny"].includes(q.decision) ||
		!validId(q.authority?.userId) ||
		!validId(q.authority?.agentId) ||
		q.authority.versionId !== q.versionId ||
		!["crm-user", "crm-schedule"].includes(q.authority.authenticator) ||
		q.authority.principalType !==
			(q.authority.authenticator === "crm-user" ? "user" : "runtime")
	)
		throw new TypeError("Invalid server-owned continuation claim");
	return q;
}
function secretKey(secret) {
	if (typeof secret !== "string" || Buffer.byteLength(secret) < 32)
		throw new TypeError("A strong bridge secret is required");
	return secret;
}
const bodyFor = (q) => ({
	inputResponses: [{ requestId: q.requestId, optionId: q.decision }],
});
function signature(input, secret) {
	return createHmac("sha256", secretKey(secret)).update(input).digest();
}
export function mintContinuationToken(claim, secret, at = Date.now()) {
	validateClaim(claim);
	if (!Number.isFinite(at)) throw new TypeError("Invalid token time");
	const iat = Math.floor(at / 1000);
	const payload = {
		iss: ISSUER,
		aud: AUDIENCE,
		iat,
		nbf: iat - 5,
		exp: iat + 60,
		claim,
		bodyDigest: sha256Hex(bodyFor(claim)),
	};
	const prefix = [{ alg: "HS256", typ: "JWT" }, payload]
		.map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
		.join(".");
	return `${prefix}.${signature(prefix, secret).toString("base64url")}`;
}
async function boundedText(stream, signal) {
	if (!stream) return "";
	const reader = stream.getReader();
	const chunks = [];
	let size = 0;
	const aborted = () => {
		void reader.cancel().catch(() => {});
	};
	signal?.addEventListener("abort", aborted, { once: true });
	try {
		for (;;) {
			if (signal?.aborted) throw new Error("Request deadline exceeded");
			const item = await reader.read();
			if (item.done) break;
			size += item.value.byteLength;
			if (size > MAX_BYTES) throw new Error("Body limit exceeded");
			chunks.push(item.value);
		}
		if (signal?.aborted) throw new Error("Request deadline exceeded");
		return new TextDecoder("utf-8", { fatal: true }).decode(
			Buffer.concat(chunks),
		);
	} finally {
		signal?.removeEventListener("abort", aborted);
		void reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
/** Dedicated endpoint-bound, body-bound, one-use authority. Not a general CRM user JWT. */
export async function authenticateContinuationRequest(
	request,
	secret,
	admit,
	at = () => Date.now(),
) {
	try {
		if (typeof admit !== "function" || request.method !== "POST") return null;
		const header = request.headers.get("authorization");
		if (!header?.startsWith("Bearer ") || header.length > 10000) return null;
		const parts = header.slice(7).split(".");
		if (parts.length !== 3 || !parts.every((x) => /^[A-Za-z0-9_-]+$/.test(x)))
			return null;
		const alg = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
		if (alg.alg !== "HS256" || alg.typ !== "JWT") return null;
		const expected = signature(`${parts[0]}.${parts[1]}`, secret),
			given = Buffer.from(parts[2], "base64url");
		if (given.length !== expected.length || !timingSafeEqual(given, expected))
			return null;
		const data = JSON.parse(
			Buffer.from(parts[1], "base64url").toString("utf8"),
		);
		const seconds = Math.floor(at() / 1000);
		if (
			data.iss !== ISSUER ||
			data.aud !== AUDIENCE ||
			![data.iat, data.nbf, data.exp, seconds].every(Number.isSafeInteger) ||
			data.exp - data.iat !== 60 ||
			data.nbf !== data.iat - 5 ||
			seconds < data.nbf ||
			seconds >= data.exp
		)
			return null;
		const q = validateClaim(data.claim),
			url = new URL(request.url);
		if (
			url.pathname !== `/eve/v1/session/${encodeURIComponent(q.sessionId)}` ||
			url.search
		)
			return null;
		if (
			request.headers.get("content-encoding") ||
			request.headers.get("content-type")?.split(";", 1)[0].trim() !==
				"application/json"
		)
			return null;
		const size = request.headers.get("content-length");
		if (size && (!/^\d+$/.test(size) || Number(size) > MAX_BYTES)) return null;
		const text = await boundedText(
			request.clone().body,
			AbortSignal.timeout(5000),
		);
		const body = JSON.parse(text);
		if (
			canonicalJson(body) !== canonicalJson(bodyFor(q)) ||
			sha256Hex(body) !== data.bodyDigest ||
			Math.floor(at() / 1000) >= data.exp
		)
			return null;
		const authority = await admit(q);
		if (!authority || Math.floor(at() / 1000) >= data.exp) return null;
		return {
			authenticator: authority.authenticator,
			principalType: authority.principalType,
			principalId: authority.userId,
			attributes: {
				purpose: "team-agent",
				runId: q.runId,
				agentId: authority.agentId,
				versionId: q.versionId,
				userId: authority.userId,
				continuationId: q.id,
				continuationCallId: q.callId,
			},
		};
	} catch {
		return null;
	}
}
/** Fixed deployment host; no user URL, redirect, automatic retry or new-session endpoint. */
export function createExactSessionTransport({
	baseUrl,
	secret,
	fetchImpl = fetch,
	clock = () => Date.now(),
	timeoutMs = 30000,
} = {}) {
	const base = new URL(baseUrl);
	secretKey(secret);
	const local = ["127.0.0.1", "[::1]", "localhost"].includes(base.hostname);
	if (
		base.username ||
		base.password ||
		base.search ||
		base.hash ||
		base.pathname !== "/" ||
		(base.protocol !== "https:" && !(base.protocol === "http:" && local))
	)
		throw new TypeError("Use a fixed HTTPS agent origin or loopback HTTP");
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000)
		throw new TypeError("Invalid delivery timeout");
	return async (claim) => {
		const q = validateClaim(claim);
		const deadline = AbortSignal.timeout(timeoutMs);
		const response = await fetchImpl(
			new URL(`/eve/v1/session/${encodeURIComponent(q.sessionId)}`, base),
			{
				method: "POST",
				redirect: "error",
				signal: deadline,
				headers: {
					authorization: `Bearer ${mintContinuationToken(q, secret, clock())}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(bodyFor(q)),
			},
		);
		if (!response.ok) {
			void response.body?.cancel().catch(() => {});
			throw new Error("Native continuation was not acknowledged");
		}
		const sessionId = response.headers.get("x-eve-session-id");
		if (sessionId) {
			void response.body?.cancel().catch(() => {});
			if (sessionId !== q.sessionId)
				throw new Error("Native session identity changed");
			return { sessionId };
		}
		const body = JSON.parse(await boundedText(response.body, deadline));
		if (body.sessionId !== q.sessionId)
			throw new Error("Native acknowledgement has no exact session identity");
		return { sessionId: body.sessionId };
	};
}
