import assert from "node:assert/strict";
import { mkdir, rm, rmdir, symlink } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const packageScope = path.join(repositoryRoot, "node_modules", "@crm");
const links = [
	["action-registry", path.join(repositoryRoot, "packages", "action-registry")],
	[
		"agent-action-runtime",
		path.join(repositoryRoot, "packages", "agent-action-runtime"),
	],
];
const createdLinks = [];
let createGovernedRunActionRuntime;

before(async () => {
	await mkdir(packageScope, { recursive: true });
	for (const [name, target] of links) {
		const link = path.join(packageScope, name);
		try {
			await symlink(
				target,
				link,
				process.platform === "win32" ? "junction" : "dir",
			);
			createdLinks.push(link);
		} catch (error) {
			if (error?.code !== "EEXIST") throw error;
		}
	}
	({ createGovernedRunActionRuntime } = await import(
		`${pathToFileURL(path.join(repositoryRoot, "apps", "agent", "src", "governed-run-action-runtime.mjs")).href}?test=${Date.now()}`
	));
});

after(async () => {
	for (const link of createdLinks.reverse()) await rm(link, { force: true });
	try {
		await rmdir(packageScope);
	} catch (error) {
		if (error?.code !== "ENOTEMPTY" && error?.code !== "ENOENT") throw error;
	}
	try {
		await rmdir(path.join(repositoryRoot, "node_modules"));
	} catch (error) {
		if (error?.code !== "ENOTEMPTY" && error?.code !== "ENOENT") throw error;
	}
});

function fakePrisma() {
	const receipts = new Map();
	const audits = [];
	const keyOf = (workspaceId, actionId, idempotencyKey) =>
		`${workspaceId}|${actionId}|${idempotencyKey}`;
	const receiptDelegate = {
		async findUnique({ where }) {
			const key = where.workspaceId_actionId_idempotencyKey;
			return structuredClone(
				receipts.get(
					keyOf(key.workspaceId, key.actionId, key.idempotencyKey),
				) ?? null,
			);
		},
		async create({ data }) {
			const key = keyOf(data.workspaceId, data.actionId, data.idempotencyKey);
			if (receipts.has(key)) {
				const error = new Error("unique");
				error.code = "P2002";
				throw error;
			}
			const row = {
				id: `receipt-${receipts.size + 1}`,
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
				const directMatch =
					(!where.id || row.id === where.id) &&
					(where.version === undefined || row.version === where.version) &&
					(!where.workspaceId || row.workspaceId === where.workspaceId) &&
					(!where.actionId || row.actionId === where.actionId) &&
					(!where.idempotencyKey ||
						row.idempotencyKey === where.idempotencyKey) &&
					(!where.payloadDigest || row.payloadDigest === where.payloadDigest) &&
					(!where.status || row.status === where.status) &&
					(!where.leaseTokenHash ||
						row.leaseTokenHash === where.leaseTokenHash);
				const orMatch =
					!where.OR ||
					where.OR.some(
						(condition) =>
							(condition.status && row.status === condition.status) ||
							(condition.leaseExpiresAt?.lte &&
								row.leaseExpiresAt <= condition.leaseExpiresAt.lte),
					);
				if (!directMatch || !orMatch) continue;
				const next = { ...row };
				for (const [field, value] of Object.entries(data)) {
					next[field] =
						value && typeof value === "object" && "increment" in value
							? (next[field] ?? 0) + value.increment
							: structuredClone(value);
				}
				receipts.set(key, next);
				count += 1;
			}
			return { count };
		},
	};
	const approvalDelegate = {
		async updateMany() {
			return { count: 0 };
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
		async $transaction(callback) {
			return callback(client);
		},
	};
	return { client, receipts, audits };
}

const TEST_TENANT_ID = "tenant-test-001";

const trustedContext = Object.freeze({
	tenantId: TEST_TENANT_ID,
	actorId: "agent-run:run-1",
	requestId: "agent-action:run-1:call-1",
	correlationId: "correlation-1",
	permissions: Object.freeze(["crm.activity.create"]),
});

function fixture(overrides = {}) {
	const prisma = fakePrisma();
	const observed = [];
	const loadTrustedContext =
		overrides.loadTrustedContext ??
		(async ({ actionId, runId, callId }) => ({
			...trustedContext,
			actorId: `agent-run:${runId}`,
			requestId: `agent-action:${runId}:${callId}`,
			permissions: [actionId],
		}));
	const authorize = overrides.authorize ?? (async () => true);
	const evaluatePolicy =
		overrides.evaluatePolicy ??
		(async () => ({ allowed: true, requiresApproval: false }));
	const executeCrmActivity =
		overrides.executeCrmActivity ??
		(async (request) => {
			observed.push(request);
			return {
				actionId: "action-1",
				activityId: "activity-1",
				replayed: false,
			};
		});
	const executeSlackMessage =
		overrides.executeSlackMessage ??
		(async (request) => {
			observed.push(request);
			return {
				actionId: "action-2",
				messageId: "C123:1.0",
				destination: "#sales",
				replayed: false,
			};
		});
	const runtime = createGovernedRunActionRuntime({
		prisma: prisma.client,
		loadTrustedContext,
		authorize,
		evaluatePolicy,
		executeCrmActivity,
		executeSlackMessage,
		clock: () => new Date("2026-09-01T00:00:00.000Z"),
	});
	return { runtime, prisma, observed };
}

beforeEach(() => {
	// Each fixture owns isolated durable stores, so no state is shared between tests.
});

test("publishes only the two governed external run actions", () => {
	const { runtime } = fixture();
	assert.deepEqual(runtime.actionIds, [
		"crm.activity.create",
		"slack.message.post",
	]);
	assert.equal(runtime.hasAction("run.summary"), false);
	assert.deepEqual(
		runtime.listActions().map((manifest) => manifest.id),
		["crm.activity.create", "slack.message.post"],
	);
});

test("passes the full governed idempotency envelope to the CRM side effect", async () => {
	const { runtime, observed, prisma } = fixture();
	const result = await runtime.executeCrmActivity({
		runId: "run-1",
		callId: "call-1",
		input: {
			type: "NOTE",
			targetKind: "company",
			targetId: "company-1",
			subject: "Follow-up",
			body: "Call the decision maker.",
		},
	});

	assert.deepEqual(result, {
		actionId: "action-1",
		activityId: "activity-1",
		replayed: false,
	});
	assert.equal(observed.length, 1);
	assert.equal(observed[0].idempotencyKey, "run-1:call-1");
	assert.match(observed[0].operationDigest, /^[a-f0-9]{64}$/);
	assert.equal(observed[0].attempt, 1);
	assert.equal(observed[0].context.tenantId, TEST_TENANT_ID);
	assert.deepEqual(
		prisma.audits.map((event) => event.eventType),
		["agent.action.started", "agent.action.succeeded"],
	);
});

test("replays a completed governed receipt without repeating the business side effect", async () => {
	const { runtime, observed, prisma } = fixture();
	const request = {
		runId: "run-1",
		callId: "call-1",
		input: {
			type: "NOTE",
			targetKind: "company",
			targetId: "company-1",
			subject: "Follow-up",
		},
	};
	const first = await runtime.executeCrmActivity(request);
	const replay = await runtime.executeCrmActivity(request);
	assert.equal(first.replayed, false);
	assert.deepEqual(replay, { ...first, replayed: true });
	assert.equal([...prisma.receipts.values()][0].resultJson.replayed, false);
	assert.equal(observed.length, 1);
});

test("marks Slack receipt replay while preserving its destination and one side effect", async () => {
	const { runtime, observed } = fixture();
	const request = {
		runId: "run-2",
		callId: "call-slack",
		input: { text: "Follow up." },
	};
	const first = await runtime.executeSlackMessage(request);
	const replay = await runtime.executeSlackMessage(request);
	assert.equal(first.replayed, false);
	assert.deepEqual(replay, { ...first, replayed: true });
	assert.equal(observed.length, 1);
});

test("rechecks authorization before returning a completed receipt", async () => {
	let allowed = true;
	const { runtime, observed } = fixture({ authorize: async () => allowed });
	const request = {
		runId: "run-1",
		callId: "call-1",
		input: {
			type: "NOTE",
			targetKind: "company",
			targetId: "company-1",
			subject: "Follow-up",
		},
	};
	await runtime.executeCrmActivity(request);
	allowed = false;
	await assert.rejects(
		runtime.executeCrmActivity(request),
		(error) => error?.code === "ACTION_FORBIDDEN",
	);
	assert.equal(observed.length, 1);
});

test("isolates replay metadata from an overlapping fresh action", async () => {
	let release;
	let started;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	const ready = new Promise((resolve) => {
		started = resolve;
	});
	let writes = 0;
	const { runtime } = fixture({
		executeCrmActivity: async (request) => {
			writes += 1;
			if (request.callId === "call-pending") {
				started();
				await pending;
			}
			return {
				actionId: request.callId,
				activityId: request.callId,
				replayed: false,
			};
		},
	});
	const input = {
		type: "NOTE",
		targetKind: "company",
		targetId: "company-1",
		subject: "Follow-up",
	};
	const complete = { runId: "run-1", callId: "call-complete", input };
	await runtime.executeCrmActivity(complete);
	const fresh = runtime.executeCrmActivity({
		runId: "run-1",
		callId: "call-pending",
		input,
	});
	await ready;
	try {
		assert.equal((await runtime.executeCrmActivity(complete)).replayed, true);
	} finally {
		release();
	}
	assert.equal((await fresh).replayed, false);
	assert.equal(writes, 2);
});

test("rejects reuse of one run call for different business input", async () => {
	const { runtime, observed } = fixture();
	await runtime.executeCrmActivity({
		runId: "run-1",
		callId: "call-1",
		input: {
			type: "NOTE",
			targetKind: "company",
			targetId: "company-1",
			subject: "First",
		},
	});
	await assert.rejects(
		runtime.executeCrmActivity({
			runId: "run-1",
			callId: "call-1",
			input: {
				type: "NOTE",
				targetKind: "company",
				targetId: "company-1",
				subject: "Changed",
			},
		}),
		(error) => error?.code === "IDEMPOTENCY_KEY_REUSED",
	);
	assert.equal(observed.length, 1);
});

test("denies execution before the side effect when object authorization fails", async () => {
	const { runtime, observed } = fixture({ authorize: async () => false });
	await assert.rejects(
		runtime.executeCrmActivity({
			runId: "run-1",
			callId: "call-1",
			input: {
				type: "NOTE",
				targetKind: "company",
				targetId: "company-2",
				subject: "Denied",
			},
		}),
		(error) => error?.code === "ACTION_FORBIDDEN",
	);
	assert.equal(observed.length, 0);
});

test("rejects model/control-field injection and invalid business input", async () => {
	const { runtime, observed } = fixture();
	await assert.rejects(
		runtime.executeCrmActivity({
			runId: "run-1",
			callId: "call-1",
			input: {
				type: "NOTE",
				targetKind: "company",
				targetId: "company-1",
				subject: "Unsafe",
				workspaceId: "other-tenant",
			},
		}),
		/unsupported fields|tenant/i,
	);
	await assert.rejects(
		runtime.executeCrmActivity({
			runId: "run-1",
			callId: "call-2",
			input: { type: "TASK", targetKind: "company", targetId: "company-1" },
		}),
		/needs a subject/i,
	);
	assert.equal(observed.length, 0);
});

test("honors cancellation before acquiring or executing a side effect", async () => {
	const controller = new AbortController();
	controller.abort(new Error("cancelled by run"));
	const { runtime, observed, prisma } = fixture();
	await assert.rejects(
		runtime.executeCrmActivity({
			runId: "run-1",
			callId: "call-1",
			input: {
				type: "NOTE",
				targetKind: "company",
				targetId: "company-1",
				subject: "Cancelled",
			},
			signal: controller.signal,
		}),
		(error) => error?.code === "ACTION_CANCELLED",
	);
	assert.equal(observed.length, 0);
	assert.equal(prisma.receipts.size, 0);
});

test("routes Slack through the same governed receipt and execution envelope", async () => {
	const { runtime, observed } = fixture();
	const result = await runtime.executeSlackMessage({
		runId: "run-2",
		callId: "call-slack",
		input: { text: "A deal needs attention." },
	});
	assert.deepEqual(result, {
		actionId: "action-2",
		messageId: "C123:1.0",
		destination: "#sales",
		replayed: false,
	});
	assert.equal(observed[0].idempotencyKey, "run-2:call-slack");
	assert.match(observed[0].operationDigest, /^[a-f0-9]{64}$/);
	assert.equal(observed[0].context.permissions[0], "slack.message.post");
});

test("rejects accessor-backed request fields without invoking application code", async () => {
	const { runtime, observed } = fixture();
	let getterCalls = 0;
	const request = {
		callId: "call-1",
		input: {
			type: "NOTE",
			targetKind: "company",
			targetId: "company-1",
			subject: "Unsafe",
		},
	};
	Object.defineProperty(request, "runId", {
		enumerable: true,
		get() {
			getterCalls += 1;
			return "run-1";
		},
	});

	await assert.rejects(
		runtime.executeCrmActivity(request),
		/enumerable data property/i,
	);
	assert.equal(getterCalls, 0);
	assert.equal(observed.length, 0);
});

test("rejects accessor-backed business input without evaluating its getter", async () => {
	const { runtime, observed } = fixture();
	let getterCalls = 0;
	const input = {
		type: "NOTE",
		targetKind: "company",
		targetId: "company-1",
	};
	Object.defineProperty(input, "subject", {
		enumerable: true,
		get() {
			getterCalls += 1;
			return "Unsafe";
		},
	});

	await assert.rejects(
		runtime.executeCrmActivity({ runId: "run-1", callId: "call-1", input }),
		/enumerable data property/i,
	);
	assert.equal(getterCalls, 0);
	assert.equal(observed.length, 0);
});

test("rejects ambiguous identifier separators before deriving an idempotency key", async () => {
	const { runtime, observed, prisma } = fixture();
	await assert.rejects(
		runtime.executeCrmActivity({
			runId: "run:1",
			callId: "call-1",
			input: {
				type: "NOTE",
				targetKind: "company",
				targetId: "company-1",
				subject: "Unsafe",
			},
		}),
		/must match/i,
	);
	await assert.rejects(
		runtime.executeCrmActivity({
			runId: "run-1",
			callId: "call:1",
			input: {
				type: "NOTE",
				targetKind: "company",
				targetId: "company-1",
				subject: "Unsafe",
			},
		}),
		/must match/i,
	);
	assert.equal(observed.length, 0);
	assert.equal(prisma.receipts.size, 0);
});

test("rejects malformed policy decisions before acquiring a receipt", async () => {
	const { runtime, observed, prisma } = fixture({
		evaluatePolicy: async () => ({ allowed: true, requiresApproval: "no" }),
	});
	await assert.rejects(
		runtime.executeCrmActivity({
			runId: "run-1",
			callId: "call-1",
			input: {
				type: "NOTE",
				targetKind: "company",
				targetId: "company-1",
				subject: "Unsafe",
			},
		}),
		(error) => error?.code === "POLICY_EVALUATION_FAILED",
	);
	assert.equal(observed.length, 0);
	assert.equal(prisma.receipts.size, 0);
});

test("rejects misspelled runtime dependencies instead of ignoring configuration", () => {
	const prisma = fakePrisma();
	assert.throws(
		() =>
			createGovernedRunActionRuntime({
				prisma: prisma.client,
				loadTrustedContext: async () => trustedContext,
				authorize: async () => true,
				evaluatePolicy: async () => ({ allowed: true }),
				executeCrmActivity: async () => ({
					actionId: "a",
					activityId: "b",
					replayed: false,
				}),
				executeSlackMessage: async () => ({
					actionId: "a",
					messageId: "b",
					destination: "c",
					replayed: false,
				}),
				receiptLeeseMs: 30_000,
			}),
		/unsupported fields/i,
	);
});
