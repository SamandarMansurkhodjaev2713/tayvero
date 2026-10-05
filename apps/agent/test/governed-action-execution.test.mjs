import assert from "node:assert/strict";
import { mkdir, rm, rmdir, symlink } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createActionRegistry } from "../../../packages/action-registry/src/index.mjs";
import {
	createGovernedActionExecutor,
	createMemoryReceiptStore,
} from "../../../packages/agent-action-runtime/src/index.mjs";
import { createAgentActionExecutionServiceCore } from "../src/governed-action-service-core.mjs";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const packageScope = path.join(repositoryRoot, "node_modules", "@crm");
const runtimeLink = path.join(packageScope, "agent-action-runtime");
let createdRuntimeLink = false;
let productionModule;
let prismaCompositionModule;

before(async () => {
	await mkdir(packageScope, { recursive: true });
	try {
		await symlink(
			path.join(repositoryRoot, "packages", "agent-action-runtime"),
			runtimeLink,
			process.platform === "win32" ? "junction" : "dir",
		);
		createdRuntimeLink = true;
	} catch (error) {
		if (error?.code !== "EEXIST") throw error;
	}
	productionModule = await import(
		`${pathToFileURL(path.join(repositoryRoot, "apps", "agent", "src", "governed-action-execution.mjs")).href}?test=${Date.now()}`
	);
	prismaCompositionModule = await import(
		`${pathToFileURL(path.join(repositoryRoot, "apps", "agent", "src", "governed-action-prisma-composition.mjs")).href}?test=${Date.now()}`
	);
});

after(async () => {
	if (createdRuntimeLink) await rm(runtimeLink, { force: true });
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

function createFixture(createService) {
	let observed;
	const audits = [];
	const registry = createActionRegistry().register(
		{
			id: "crm.deal.update",
			version: "1",
			risk: "MEDIUM",
			mutating: true,
			idempotency: "KEYED",
			permissions: ["crm.deal.update"],
			timeoutMs: 100,
			inputSchema: {
				type: "object",
				additionalProperties: false,
				required: ["dealId"],
				properties: { dealId: { type: "string", minLength: 1 } },
			},
			outputSchema: {
				type: "object",
				additionalProperties: false,
				required: ["ok"],
				properties: { ok: { type: "boolean" } },
			},
		},
		async (execution) => {
			observed = execution;
			return { ok: true };
		},
	);
	const dependencies = {
		registry,
		authorizer: async () => true,
		policyEvaluator: async () => ({ allowed: true, requiresApproval: false }),
		receiptStore: createMemoryReceiptStore(),
		auditSink: {
			async append(event) {
				audits.push(event);
			},
		},
		clock: () => new Date("2026-09-01T00:00:00.000Z"),
	};
	return {
		service: createService(dependencies),
		getObserved: () => observed,
		audits,
	};
}

const trustedContext = Object.freeze({
	tenantId: "tenant-a",
	actorId: "agent-run-1",
	requestId: "request-1",
	permissions: Object.freeze(["crm.deal.update"]),
});

test("the dependency-free service core delegates only through the governed executor", async () => {
	const fixture = createFixture((dependencies) =>
		createAgentActionExecutionServiceCore(
			dependencies,
			createGovernedActionExecutor,
		),
	);
	const result = await fixture.service.executeModelProposedAction(
		{ actionId: "crm.deal.update", input: { dealId: "deal-1" } },
		trustedContext,
		{ idempotencyKey: "provider-operation-1" },
	);

	assert.deepEqual(result, { ok: true });
	assert.equal(fixture.getObserved().idempotencyKey, "provider-operation-1");
	assert.match(fixture.getObserved().operationDigest, /^[a-f0-9]{64}$/);
	assert.deepEqual(
		fixture.audits.map((event) => event.type),
		["agent.action.started", "agent.action.succeeded"],
	);
});

test("the production service composition uses the same governed path", async () => {
	const fixture = createFixture(
		productionModule.createAgentActionExecutionService,
	);
	await fixture.service.executeModelProposedAction(
		{ actionId: "crm.deal.update", input: { dealId: "deal-2" } },
		trustedContext,
		{ idempotencyKey: "provider-operation-2" },
	);
	assert.equal(fixture.getObserved().idempotencyKey, "provider-operation-2");
});

test("requires an explicit catalog-only registry", () => {
	assert.throws(
		() =>
			createAgentActionExecutionServiceCore(
				{ registry: { execute() {} } },
				createGovernedActionExecutor,
			),
		/catalog only|explicitly provide/,
	);
	assert.throws(
		() =>
			createAgentActionExecutionServiceCore({}, createGovernedActionExecutor),
		/registry/,
	);
});

test("rejects model attempts to provide execution context or control fields", async () => {
	const fixture = createFixture((dependencies) =>
		createAgentActionExecutionServiceCore(
			dependencies,
			createGovernedActionExecutor,
		),
	);
	await assert.rejects(
		fixture.service.executeModelProposedAction(
			{
				actionId: "crm.deal.update",
				input: { dealId: "deal-1" },
				tenantId: "tenant-b",
			},
			trustedContext,
			{ idempotencyKey: "provider-operation-3" },
		),
		/unsupported control fields/,
	);
});

test("rejects invalid input before any action executor side effect", async () => {
	const fixture = createFixture((dependencies) =>
		createAgentActionExecutionServiceCore(
			dependencies,
			createGovernedActionExecutor,
		),
	);
	await assert.rejects(
		fixture.service.executeModelProposedAction(
			{ actionId: "crm.deal.update", input: {} },
			trustedContext,
			{ idempotencyKey: "provider-operation-4" },
		),
		(error) => error?.code === "SCHEMA_VALIDATION_FAILED",
	);
	assert.equal(fixture.getObserved(), undefined);
});

test("rejects invalid cancellation objects and unknown execution options", async () => {
	const fixture = createFixture((dependencies) =>
		createAgentActionExecutionServiceCore(
			dependencies,
			createGovernedActionExecutor,
		),
	);
	await assert.rejects(
		fixture.service.executeModelProposedAction(
			{ actionId: "crm.deal.update", input: { dealId: "deal-1" } },
			trustedContext,
			{ idempotencyKey: "provider-operation-5", signal: {} },
		),
		/AbortSignal/,
	);
	await assert.rejects(
		fixture.service.executeModelProposedAction(
			{ actionId: "crm.deal.update", input: { dealId: "deal-1" } },
			trustedContext,
			{ idempotencyKey: "provider-operation-6", context: trustedContext },
		),
		/unsupported fields/,
	);
});

function createFakePrisma() {
	const receipts = new Map();
	const approvals = new Map();
	const audits = [];
	const receiptKey = (workspaceId, actionId, idempotencyKey) =>
		`${workspaceId}|${actionId}|${idempotencyKey}`;
	const receiptDelegate = {
		async findUnique({ where }) {
			const key = where.workspaceId_actionId_idempotencyKey;
			return structuredClone(
				receipts.get(
					receiptKey(key.workspaceId, key.actionId, key.idempotencyKey),
				) ?? null,
			);
		},
		async create({ data }) {
			const key = receiptKey(
				data.workspaceId,
				data.actionId,
				data.idempotencyKey,
			);
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
	return { client, receipts, approvals, audits };
}

test("the Prisma composition persists receipts and audit through the governed path", async () => {
	const fake = createFakePrisma();
	let calls = 0;
	const registry = createActionRegistry().register(
		{
			id: "crm.deal.update",
			version: "1",
			risk: "MEDIUM",
			mutating: true,
			idempotency: "KEYED",
			permissions: ["crm.deal.update"],
			timeoutMs: 100,
			inputSchema: {
				type: "object",
				additionalProperties: false,
				required: ["dealId"],
				properties: { dealId: { type: "string" } },
			},
			outputSchema: {
				type: "object",
				additionalProperties: false,
				required: ["ok"],
				properties: { ok: { type: "boolean" } },
			},
		},
		async () => {
			calls += 1;
			return { ok: true };
		},
	);
	const service =
		prismaCompositionModule.createPrismaBackedAgentActionExecution({
			prisma: fake.client,
			registry,
			authorizer: async () => true,
			policyEvaluator: async () => ({ allowed: true }),
			clock: () => new Date("2026-09-01T00:00:00.000Z"),
		});
	const proposal = {
		actionId: "crm.deal.update",
		input: { dealId: "deal-prisma" },
	};
	const options = { idempotencyKey: "provider-prisma-1" };

	assert.deepEqual(
		await service.executeModelProposedAction(proposal, trustedContext, options),
		{ ok: true },
	);
	assert.deepEqual(
		await service.executeModelProposedAction(proposal, trustedContext, options),
		{ ok: true },
	);
	assert.equal(calls, 1);
	assert.equal(fake.receipts.size, 1);
	assert.equal(fake.audits.length, 2);
});

test("the Prisma composition fails fast when governance dependencies are missing", () => {
	assert.throws(
		() =>
			prismaCompositionModule.createPrismaBackedAgentActionExecution({
				prisma: {},
			}),
		/registry is required/,
	);
	assert.throws(
		() =>
			prismaCompositionModule.createPrismaBackedAgentActionExecution({
				prisma: {},
				registry: createActionRegistry(),
				authorizer: null,
				policyEvaluator: async () => ({ allowed: true }),
			}),
		/authorizer must be a function/,
	);
});
