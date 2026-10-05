import assert from "node:assert/strict";
import test from "node:test";
import {
	createPrismaApprovalStore,
	createPrismaAuditSink,
	createPrismaReceiptStore,
	GovernedActionError,
} from "../src/index.mjs";

function fakePrisma() {
	const receipts = new Map();
	const approvals = new Map();
	const audits = [];
	const keyOf = (w, a, k) => `${w}|${a}|${k}`;
	const receiptDelegate = {
		async findUnique({ where }) {
			const x = where.workspaceId_actionId_idempotencyKey;
			return structuredClone(
				receipts.get(keyOf(x.workspaceId, x.actionId, x.idempotencyKey)) ??
					null,
			);
		},
		async create({ data }) {
			const key = keyOf(data.workspaceId, data.actionId, data.idempotencyKey);
			if (receipts.has(key)) {
				const e = new Error("unique");
				e.code = "P2002";
				throw e;
			}
			const row = {
				id: `r-${receipts.size + 1}`,
				version: 0,
				resultJson: null,
				errorCode: null,
				completedAt: null,
				...structuredClone(data),
			};
			receipts.set(key, row);
			return structuredClone(row);
		},
		async updateMany({ where, data }) {
			let count = 0;
			for (const [key, row] of receipts) {
				const match =
					(!where.id || row.id === where.id) &&
					((!where.version && where.version !== 0) ||
						row.version === where.version) &&
					(!where.workspaceId || row.workspaceId === where.workspaceId) &&
					(!where.actionId || row.actionId === where.actionId) &&
					(!where.idempotencyKey ||
						row.idempotencyKey === where.idempotencyKey) &&
					(!where.payloadDigest || row.payloadDigest === where.payloadDigest) &&
					(!where.status || row.status === where.status) &&
					(!where.leaseTokenHash ||
						row.leaseTokenHash === where.leaseTokenHash);
				let orOk = true;
				if (where.OR) {
					orOk = where.OR.some(
						(c) =>
							(c.status && row.status === c.status) ||
							(c.leaseExpiresAt?.lte &&
								row.leaseExpiresAt <= c.leaseExpiresAt.lte),
					);
				}
				if (!match || !orOk) continue;
				const next = { ...row };
				for (const [k, v] of Object.entries(data)) {
					next[k] =
						v && typeof v === "object" && "increment" in v
							? (next[k] ?? 0) + v.increment
							: structuredClone(v);
				}
				receipts.set(key, next);
				count++;
			}
			return { count };
		},
	};
	const approvalDelegate = {
		async updateMany({ where, data }) {
			const row = approvals.get(where.id);
			if (
				!row ||
				row.workspaceId !== where.workspaceId ||
				row.actionId !== where.actionId ||
				row.payloadDigest !== where.payloadDigest ||
				row.requestedById !== where.requestedById ||
				row.status !== where.status ||
				row.consumedAt !== where.consumedAt ||
				!(row.expiresAt > where.expiresAt.gt)
			)
				return { count: 0 };
			approvals.set(where.id, {
				...row,
				...data,
				version: row.version + data.version.increment,
			});
			return { count: 1 };
		},
	};
	const auditDelegate = {
		async create({ data }) {
			audits.push(structuredClone(data));
			return data;
		},
	};
	const client = {
		governedActionReceipt: receiptDelegate,
		governedActionApproval: approvalDelegate,
		governedActionAuditEvent: auditDelegate,
		async $transaction(cb) {
			return cb(client);
		},
	};
	return { client, receipts, approvals, audits };
}

const now = new Date("2026-08-31T00:00:00Z");
test("receipt store atomically acquires, completes and replays", async () => {
	const f = fakePrisma();
	const store = createPrismaReceiptStore({ prisma: f.client });
	const args = { key: "k", digest: "d", tenantId: "t", actionId: "a", now };
	const first = await store.begin(args);
	assert.equal(first.status, "ACQUIRED");
	const concurrent = await store.begin(args);
	assert.equal(concurrent.status, "IN_PROGRESS");
	await store.succeed({
		lease: first.lease,
		digest: "d",
		result: { ok: true },
		now,
	});
	const replay = await store.begin(args);
	assert.equal(replay.status, "SUCCEEDED");
	assert.deepEqual(replay.result, { ok: true });
});
test("receipt rejects same key with another digest", async () => {
	const f = fakePrisma();
	const store = createPrismaReceiptStore({ prisma: f.client });
	await store.begin({
		key: "k",
		digest: "d1",
		tenantId: "t",
		actionId: "a",
		now,
	});
	await assert.rejects(
		store.begin({ key: "k", digest: "d2", tenantId: "t", actionId: "a", now }),
		(e) =>
			e instanceof GovernedActionError && e.code === "IDEMPOTENCY_KEY_REUSED",
	);
});
test("receipt completion requires the acquired lease token", async () => {
	const f = fakePrisma();
	const store = createPrismaReceiptStore({ prisma: f.client });
	const first = await store.begin({
		key: "k",
		digest: "d",
		tenantId: "t",
		actionId: "a",
		now,
	});
	await assert.rejects(
		store.succeed({
			lease: { ...first.lease, token: "forged" },
			digest: "d",
			result: {},
			now,
		}),
		(e) => e.code === "RECEIPT_LEASE_LOST",
	);
});
test("approval consumption is tenant, action, digest and expiry bound", async () => {
	const f = fakePrisma();
	f.approvals.set("ap", {
		id: "ap",
		workspaceId: "t",
		actionId: "a",
		payloadDigest: "d",
		requestedById: "u",
		status: "APPROVED",
		consumedAt: null,
		expiresAt: new Date(now.getTime() + 1000),
		version: 0,
	});
	const store = createPrismaApprovalStore({ prisma: f.client });
	assert.equal(
		(
			await store.consume({
				approvalId: "ap",
				tenantId: "t",
				actionId: "a",
				digest: "d",
				actorId: "u",
				now,
			})
		).consumed,
		true,
	);
	assert.equal(
		await store.consume({
			approvalId: "ap",
			tenantId: "t",
			actionId: "a",
			digest: "d",
			actorId: "u",
			now,
		}),
		null,
	);
});
test("audit sink redacts secret-bearing properties", async () => {
	const f = fakePrisma();
	const sink = createPrismaAuditSink({ prisma: f.client });
	await sink.append({
		tenantId: "t",
		actionId: "a",
		actorId: "u",
		requestId: "r",
		type: "x",
		details: { apiToken: "secret", digest: "d" },
		at: now.toISOString(),
	});
	assert.equal(f.audits[0].detailsJson.apiToken, "[REDACTED]");
});

test("expired unsafe receipt is quarantined instead of repeating an unknown external side effect", async () => {
	const f = fakePrisma();
	const store = createPrismaReceiptStore({ prisma: f.client, leaseMs: 1000 });
	const args = {
		key: "unknown",
		digest: "digest",
		tenantId: "tenant",
		actionId: "send",
		now,
	};
	await store.begin(args);
	await assert.rejects(
		store.begin({ ...args, now: new Date(now.getTime() + 2000) }),
		(e) => e.code === "ACTION_REQUIRES_RECONCILIATION",
	);
	assert.equal([...f.receipts.values()][0].status, "AMBIGUOUS");
});

test("expired receipt may replay only with an explicit safe adapter capability", async () => {
	const f = fakePrisma();
	const store = createPrismaReceiptStore({ prisma: f.client, leaseMs: 1000 });
	const args = {
		key: "safe",
		digest: "digest",
		tenantId: "tenant",
		actionId: "read",
		now,
		replaySafe: true,
	};
	const first = await store.begin(args);
	const next = await store.begin({
		...args,
		now: new Date(now.getTime() + 2000),
	});
	assert.equal(next.status, "ACQUIRED");
	assert.notEqual(next.lease.token, first.lease.token);
	await assert.rejects(
		store.succeed({ lease: first.lease, digest: "digest", result: {}, now }),
		(e) => e.code === "RECEIPT_LEASE_LOST",
	);
});

test("receipt lease covers the complete declared execution/retry budget", async () => {
	const f = fakePrisma();
	const store = createPrismaReceiptStore({ prisma: f.client, leaseMs: 1000 });
	const args = {
		key: "slow",
		digest: "digest",
		tenantId: "tenant",
		actionId: "action",
		now,
		minimumLeaseMs: 120000,
	};
	await store.begin(args);
	assert.equal(
		(await store.begin({ ...args, now: new Date(now.getTime() + 2000) }))
			.status,
		"IN_PROGRESS",
	);
});
