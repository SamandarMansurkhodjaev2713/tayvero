import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, createGovernedActionExecutor, createMemoryReceiptStore, createMemoryApprovalStore, GovernedActionError, redactForAudit, sha256Hex } from "../src/index.mjs";

const fixedNow = new Date("2026-08-31T12:00:00.000Z");
const baseContext = Object.freeze({ tenantId: "tenant-a", actorId: "user-a", requestId: "req-1", permissions: ["crm.deal.update"] });
const input = { dealId: "deal-1", value: 100 };
const digest = sha256Hex({ tenantId: "tenant-a", actionId: "crm.deal.update", manifestVersion: "1", input });

function harness(overrides = {}) {
  const calls = [];
  const audits = [];
  const entry = {
    manifest: {
      id: "crm.deal.update", version: "1", risk: overrides.risk ?? "MEDIUM", mutating: true,
      idempotency: overrides.idempotency ?? "KEYED", permissions: overrides.permissions ?? ["crm.deal.update"], timeoutMs: overrides.timeoutMs ?? 200,
      retrySafe: overrides.retrySafe ?? false,
      retry: overrides.retry ?? { attempts: 1 },
      inputValidator: overrides.inputValidator ?? ((value) => { if (!value?.dealId || !Number.isInteger(value.value)) throw new Error("bad input"); return value; }),
      outputValidator: overrides.outputValidator ?? ((value) => { if (value?.ok !== true) throw new Error("bad output"); return value; }),
    },
    async execute(execution) {
      const { input, context, attempt } = execution;
      calls.push({ ...execution, input, context, attempt });
      if (overrides.executor) return overrides.executor(execution);
      return { ok: true, dealId: input.dealId };
    },
  };
  const executor = createGovernedActionExecutor({
    registry: new Map([["crm.deal.update", entry]]),
    authorizer: overrides.authorizer ?? (async () => true),
    policyEvaluator: overrides.policyEvaluator ?? (async () => ({ allowed: true, requiresApproval: false })),
    approvalStore: overrides.approvalStore,
    receiptStore: overrides.receiptStore ?? createMemoryReceiptStore(),
    auditSink: overrides.auditSink ?? { async append(event) { audits.push(event); } },
    clock: () => fixedNow,
  });
  return { executor, calls, audits };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof GovernedActionError && error.code === code);
}

test("executes a validated authorized action and records redacted audit events", async () => {
  const { executor, calls, audits } = harness();
  const result = await executor.execute({ actionId: "crm.deal.update", context: baseContext, input: { ...input, apiToken: "secret" }, idempotencyKey: "key-1" });
  assert.equal(result.ok, true); assert.equal(calls.length, 1); assert.equal(audits.length, 2);
  assert.equal(audits[0].details.input.apiToken, "[REDACTED]");
});

test("rejects tenant ownership fields at any nesting depth", async () => {
  const { executor } = harness();
  await expectCode(executor.execute({ actionId: "crm.deal.update", context: baseContext, input: { ...input, nested: { workspaceId: "tenant-b" } }, idempotencyKey: "key-1" }), "TENANT_OVERRIDE_FORBIDDEN");
});

test("rejects missing permissions and object-level authorization", async () => {
  const a = harness();
  await expectCode(a.executor.execute({ actionId: "crm.deal.update", context: { ...baseContext, permissions: [] }, input, idempotencyKey: "key-1" }), "ACTION_FORBIDDEN");
  const b = harness({ authorizer: async () => false });
  await expectCode(b.executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "key-1" }), "ACTION_FORBIDDEN");
});

test("replays a completed idempotent result without executing again", async () => {
  const receipts = createMemoryReceiptStore();
  const { executor, calls } = harness({ receiptStore: receipts });
  const request = { actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "same" };
  const first = await executor.execute(request); const second = await executor.execute(request);
  assert.deepEqual(second, first); assert.equal(calls.length, 1);
});

test("rejects reuse of an idempotency key for another payload", async () => {
  const receipts = createMemoryReceiptStore(); const { executor } = harness({ receiptStore: receipts });
  await executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "same" });
  await expectCode(executor.execute({ actionId: "crm.deal.update", context: baseContext, input: { ...input, value: 101 }, idempotencyKey: "same" }), "IDEMPOTENCY_KEY_REUSED");
});

test("rejects changed payload after an approval failure acquired the same idempotency key", async () => {
  const receipts = createMemoryReceiptStore();
  const first = harness({ receiptStore: receipts, risk: "HIGH" });
  await expectCode(first.executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "failed-key" }), "APPROVAL_REQUIRED");
  const second = harness({ receiptStore: receipts });
  await expectCode(second.executor.execute({ actionId: "crm.deal.update", context: baseContext, input: { ...input, value: 999 }, idempotencyKey: "failed-key" }), "IDEMPOTENCY_KEY_REUSED");
});

test("allows only one concurrent execution for the same receipt", async () => {
  let release; const barrier = new Promise((resolve) => { release = resolve; });
  const { executor, calls } = harness({ executor: async () => { await barrier; return { ok: true }; } });
  const request = { actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "concurrent" };
  const first = executor.execute(request); await new Promise((resolve) => setImmediate(resolve));
  await expectCode(executor.execute(request), "ACTION_IN_PROGRESS"); release(); await first; assert.equal(calls.length, 1);
});

test("requires payload-bound tenant-bound approval for high-risk actions", async () => {
  const approvalStore = createMemoryApprovalStore([{ id: "ap-1", tenantId: "tenant-a", actionId: "crm.deal.update", digest, expiresAt: "2026-09-01T00:00:00.000Z" }]);
  const { executor } = harness({ risk: "HIGH", approvalStore });
  await expectCode(executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "a" }), "APPROVAL_REQUIRED");
  const result = await executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "a", approvalId: "ap-1" });
  assert.equal(result.ok, true);
  await expectCode(executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "b", approvalId: "ap-1" }), "APPROVAL_INVALID");
});

test("rejects approval bound to another tenant or modified payload", async () => {
  const approvalStore = createMemoryApprovalStore([{ id: "ap-1", tenantId: "tenant-a", actionId: "crm.deal.update", digest, expiresAt: "2026-09-01T00:00:00.000Z" }]);
  const { executor } = harness({ risk: "HIGH", approvalStore });
  await expectCode(executor.execute({ actionId: "crm.deal.update", context: { ...baseContext, tenantId: "tenant-b" }, input, idempotencyKey: "a", approvalId: "ap-1" }), "APPROVAL_INVALID");
});

test("times out a non-cooperative executor and records failure", async () => {
  const { executor, audits } = harness({ timeoutMs: 20, executor: async () => new Promise(() => {}) });
  await expectCode(executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "timeout" }), "ACTION_TIMEOUT");
  assert.equal(audits.at(-1).type, "agent.action.ambiguous");
  await expectCode(executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "timeout" }), "ACTION_REQUIRES_RECONCILIATION");
});

test("propagates cancellation and does not retry it", async () => {
  const controller = new AbortController();
  const { executor, calls } = harness({ retrySafe: true, retry: { attempts: 3 }, executor: async ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) });
  const pending = executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "cancel" }, { signal: controller.signal });
  controller.abort(); await expectCode(pending, "ACTION_CANCELLED"); assert.equal(calls.length, 0);
});

test("keeps the success receipt when the success audit write fails", async () => {
  const receipts = createMemoryReceiptStore();
  const auditSink = { async append(event) { if (event.type === "agent.action.succeeded") throw new Error("audit unavailable"); } };
  const first = harness({ receiptStore: receipts, auditSink });
  const request = { actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "audit-failure" };
  await expectCode(first.executor.execute(request), "AUDIT_WRITE_FAILED_AFTER_COMMIT");
  const second = harness({ receiptStore: receipts });
  const replay = await second.executor.execute(request);
  assert.equal(replay.ok, true);
  assert.equal(second.calls.length, 0);
});

test("propagates the operation digest and idempotency key to the executor", async () => {
  let observed;
  const { executor } = harness({ executor: async (args) => { observed = args; return { ok: true }; } });
  await executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "provider-key" });
  assert.equal(observed.idempotencyKey, "provider-key");
  assert.equal(typeof observed.operationDigest, "string");
  assert.equal(observed.operationDigest.length, 64);
});

test("validates untrusted model input and executor output", async () => {
  const a = harness();
  await expectCode(a.executor.execute({ actionId: "crm.deal.update", context: baseContext, input: { dealId: "d", value: "100" }, idempotencyKey: "bad" }), "SCHEMA_VALIDATION_FAILED");
  const b = harness({ executor: async () => ({ ok: false }) });
  await expectCode(b.executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "bad-output" }), "SCHEMA_VALIDATION_FAILED");
});

test("rejects mutating manifests without idempotency", async () => {
  const { executor } = harness({ idempotency: "NONE" });
  await expectCode(
    executor.execute({ actionId: "crm.deal.update", context: baseContext, input }),
    "INVALID_MANIFEST",
  );
});

test("rejects manifests without explicit permissions", async () => {
  const { executor } = harness({ permissions: [] });
  await expectCode(
    executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "missing-permissions" }),
    "INVALID_MANIFEST",
  );
});

test("rejects non-integer, non-finite and unsafe retry policies", async () => {
  for (const retry of [
    { attempts: Number.NaN },
    { attempts: Number.POSITIVE_INFINITY },
    { attempts: 1.5 },
    { attempts: 0 },
    { attempts: 6 },
    { attempts: 1, baseDelayMs: Number.NaN },
    { attempts: 1, baseDelayMs: -1 },
  ]) {
    const { executor } = harness({ retry });
    await expectCode(
      executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: `retry-${String(retry.attempts)}-${String(retry.baseDelayMs)}` }),
      "INVALID_MANIFEST",
    );
  }

  const unsafe = harness({ retry: { attempts: 2 }, retrySafe: false });
  await expectCode(
    unsafe.executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "unsafe-retry" }),
    "INVALID_MANIFEST",
  );
});

test("passes an immutable permission snapshot to validators, policy and executor", async () => {
  let observedContext;
  const { executor } = harness({
    executor: async ({ context }) => {
      observedContext = context;
      assert.equal(Object.isFrozen(context), true);
      assert.equal(Object.isFrozen(context.permissions), true);
      assert.throws(() => context.permissions.push("*"), TypeError);
      return { ok: true };
    },
  });
  const sourcePermissions = ["crm.deal.update"];
  await executor.execute({
    actionId: "crm.deal.update",
    context: { ...baseContext, permissions: sourcePermissions },
    input,
    idempotencyKey: "immutable-context",
  });
  sourcePermissions.push("*");
  assert.deepEqual(observedContext.permissions, ["crm.deal.update"]);
});

test("passes immutable validated input to business validation and authorization", async () => {
  let authorizedInput;
  const { executor } = harness({
    authorizer: async ({ input: authorized }) => {
      authorizedInput = authorized;
      assert.equal(Object.isFrozen(authorized), true);
      assert.throws(() => { authorized.value = 999; }, TypeError);
      return true;
    },
  });
  await executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "immutable-input" });
  assert.equal(authorizedInput.value, 100);
});

test("rejects invalid clock values before durable state mutation", async () => {
  const { executor, calls } = harness();
  const invalidClockExecutor = createGovernedActionExecutor({
    registry: new Map([["crm.deal.update", {
      manifest: {
        id: "crm.deal.update",
        version: "1",
        risk: "MEDIUM",
        mutating: true,
        idempotency: "KEYED",
        permissions: ["crm.deal.update"],
        timeoutMs: 100,
        retry: { attempts: 1 },
        inputValidator: (value) => value,
        outputValidator: (value) => value,
      },
      async execute() { calls.push("executed"); return { ok: true }; },
    }]]),
    authorizer: async () => true,
    policyEvaluator: async () => ({ allowed: true }),
    receiptStore: createMemoryReceiptStore(),
    auditSink: { async append() {} },
    clock: () => new Date("invalid"),
  });
  await expectCode(
    invalidClockExecutor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "invalid-clock" }),
    "INVALID_CLOCK",
  );
  assert.equal(calls.length, 0);
});

test("rejects plain object registries that could expose prototype-backed actions", () => {
  assert.throws(
    () => createGovernedActionExecutor({
      registry: { "crm.deal.update": {} },
      authorizer: async () => true,
      policyEvaluator: async () => ({ allowed: true }),
      receiptStore: createMemoryReceiptStore(),
      auditSink: { async append() {} },
    }),
    (error) => error instanceof GovernedActionError && error.code === "INVALID_DEPENDENCIES",
  );
});

test("invalid approval expiry is rejected instead of being treated as non-expiring", async () => {
  const approvalStore = createMemoryApprovalStore([{
    id: "invalid-expiry",
    tenantId: "tenant-a",
    actionId: "crm.deal.update",
    digest,
    expiresAt: "not-a-date",
  }]);
  const { executor } = harness({ risk: "HIGH", approvalStore });
  await expectCode(
    executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "invalid-expiry", approvalId: "invalid-expiry" }),
    "APPROVAL_INVALID",
  );
});

test("rejects unknown request and execution-option control fields", async () => {
  const { executor } = harness();
  await expectCode(
    executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "unknown-request", tenantId: "tenant-b" }),
    "INVALID_ACTION_REQUEST",
  );
  await expectCode(
    executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "unknown-options" }, { retry: true }),
    "INVALID_ACTION_OPTIONS",
  );
  await expectCode(
    executor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "invalid-signal" }, { signal: {} }),
    "INVALID_ACTION_OPTIONS",
  );
});

test("requires both input and output validators even for a custom registry implementation", async () => {
  for (const omitted of ["inputValidator", "outputValidator"]) {
    const rawManifest = {
      id: "crm.deal.update",
      version: "1",
      risk: "MEDIUM",
      mutating: true,
      idempotency: "KEYED",
      permissions: ["crm.deal.update"],
      timeoutMs: 100,
      retry: { attempts: 1 },
      inputValidator: (value) => value,
      outputValidator: (value) => value,
    };
    delete rawManifest[omitted];
    const runtime = createGovernedActionExecutor({
      registry: new Map([["crm.deal.update", { manifest: rawManifest, async execute() { return { ok: true }; } }]]),
      authorizer: async () => true,
      policyEvaluator: async () => ({ allowed: true }),
      receiptStore: createMemoryReceiptStore(),
      auditSink: { async append() {} },
      clock: () => fixedNow,
    });
    await expectCode(
      runtime.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: `missing-${omitted}` }),
      "INVALID_MANIFEST",
    );
  }
});

test("normalizes failures from business validation, authorization and policy evaluation", async () => {
  const businessRegistry = new Map([["crm.deal.update", {
    manifest: {
      id: "crm.deal.update",
      version: "1",
      risk: "MEDIUM",
      mutating: true,
      idempotency: "KEYED",
      permissions: ["crm.deal.update"],
      timeoutMs: 100,
      retry: { attempts: 1 },
      inputValidator: (value) => value,
      outputValidator: (value) => value,
      businessValidator() { throw new Error("sensitive business detail"); },
    },
    async execute() { return { ok: true }; },
  }]]);
  const baseDependencies = {
    registry: businessRegistry,
    receiptStore: createMemoryReceiptStore(),
    auditSink: { async append() {} },
    clock: () => fixedNow,
  };
  const businessExecutor = createGovernedActionExecutor({
    ...baseDependencies,
    authorizer: async () => true,
    policyEvaluator: async () => ({ allowed: true }),
  });
  await expectCode(
    businessExecutor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "business-failure" }),
    "BUSINESS_VALIDATION_FAILED",
  );

  const authorizationExecutor = createGovernedActionExecutor({
    ...baseDependencies,
    registry: new Map([["crm.deal.update", {
      manifest: {
        id: "crm.deal.update", version: "1", risk: "MEDIUM", mutating: true, idempotency: "KEYED",
        permissions: ["crm.deal.update"], timeoutMs: 100, retry: { attempts: 1 },
        inputValidator: (value) => value, outputValidator: (value) => value,
      },
      async execute() { return { ok: true }; },
    }]]),
    authorizer: async () => { throw new Error("authorization backend unavailable"); },
    policyEvaluator: async () => ({ allowed: true }),
  });
  await expectCode(
    authorizationExecutor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "authorization-failure" }),
    "AUTHORIZATION_CHECK_FAILED",
  );

  const policyExecutor = createGovernedActionExecutor({
    ...baseDependencies,
    registry: new Map([["crm.deal.update", {
      manifest: {
        id: "crm.deal.update", version: "1", risk: "MEDIUM", mutating: true, idempotency: "KEYED",
        permissions: ["crm.deal.update"], timeoutMs: 100, retry: { attempts: 1 },
        inputValidator: (value) => value, outputValidator: (value) => value,
      },
      async execute() { return { ok: true }; },
    }]]),
    authorizer: async () => true,
    policyEvaluator: async () => { throw new Error("policy backend unavailable"); },
  });
  await expectCode(
    policyExecutor.execute({ actionId: "crm.deal.update", context: baseContext, input, idempotencyKey: "policy-failure" }),
    "POLICY_EVALUATION_FAILED",
  );
});

test("redacts common secret values even when the property name is generic", async () => {
  const audits = [];
  const { executor } = harness({
    auditSink: { async append(event) { audits.push(event); } },
  });
  await executor.execute({
    actionId: "crm.deal.update",
    context: baseContext,
    input: { ...input, note: "Bearer abcdefghijklmnopqrstuvwxyz" },
    idempotencyKey: "secret-value-redaction",
  });
  assert.equal(audits[0].details.input.note, "[REDACTED]");
});

test("memory receipt store validates its lease configuration and fails closed on lost leases", async () => {
  assert.throws(
    () => createMemoryReceiptStore({ leaseMs: Number.NaN }),
    (error) => error instanceof GovernedActionError && error.code === "INVALID_RECEIPT_CONFIG",
  );
  const store = createMemoryReceiptStore();
  await expectCode(
    store.fail({ lease: "missing", digest: "digest", errorCode: "FAILED" }),
    "RECEIPT_LEASE_LOST",
  );
});

test("a pre-aborted request does not acquire a receipt, consume approval or call an executor", async () => {
  const events = [];
  const controller = new AbortController();
  controller.abort(new GovernedActionError("ACTION_CANCELLED", "cancelled before execution", { sideEffect: "NOT_STARTED" }));

  const receiptStore = {
    async begin() {
      events.push("receipt");
      throw new Error("receipt must not be acquired");
    },
  };
  const approvalStore = {
    async consume() {
      events.push("approval");
      throw new Error("approval must not be consumed");
    },
  };
  const { executor, calls, audits } = harness({
    risk: "HIGH",
    receiptStore,
    approvalStore,
  });

  await expectCode(
    executor.execute(
      {
        actionId: "crm.deal.update",
        context: baseContext,
        input,
        idempotencyKey: "pre-aborted",
        approvalId: "approval-1",
      },
      { signal: controller.signal },
    ),
    "ACTION_CANCELLED",
  );

  assert.deepEqual(events, []);
  assert.equal(calls.length, 0);
  assert.equal(audits.length, 0);
});

test("canonical JSON rejects cyclic arrays and unsafe object keys", () => {
  const cyclic = [];
  cyclic.push(cyclic);
  assert.throws(
    () => canonicalJson(cyclic),
    (error) => error instanceof GovernedActionError && error.code === "CYCLIC_PAYLOAD",
  );

  const unsafe = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(
    () => canonicalJson(unsafe),
    (error) => error instanceof GovernedActionError && error.code === "UNSAFE_OBJECT_KEY",
  );
  assert.equal({}.polluted, undefined);
});

test("audit redaction stores unsafe property names without invoking prototype setters", () => {
  const unsafe = JSON.parse('{"__proto__":{"polluted":true},"safe":"value"}');
  const redacted = redactForAudit(unsafe);
  assert.equal(Object.hasOwn(redacted, "__proto__"), true);
  assert.equal(redacted.safe, "value");
  assert.deepEqual(redacted.__proto__, { polluted: true });
  assert.equal(Object.getPrototypeOf(redacted), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test("rejects malformed trusted correlation identifiers", async () => {
  const { executor, calls } = harness();
  await expectCode(
    executor.execute({
      actionId: "crm.deal.update",
      context: { ...baseContext, correlationId: 42 },
      input,
      idempotencyKey: "bad-correlation-type",
    }),
    "TRUSTED_CONTEXT_REQUIRED",
  );
  await expectCode(
    executor.execute({
      actionId: "crm.deal.update",
      context: { ...baseContext, correlationId: "x".repeat(513) },
      input,
      idempotencyKey: "bad-correlation-length",
    }),
    "TRUSTED_CONTEXT_REQUIRED",
  );
  assert.equal(calls.length, 0);
});

test("fails closed when policy approval metadata is malformed", async () => {
  const { executor, calls } = harness({
    policyEvaluator: async () => ({ allowed: true, requiresApproval: "yes" }),
  });
  await expectCode(
    executor.execute({
      actionId: "crm.deal.update",
      context: baseContext,
      input,
      idempotencyKey: "malformed-policy",
    }),
    "POLICY_EVALUATION_FAILED",
  );
  assert.equal(calls.length, 0);
});

test("rejects non-plain request objects without invoking custom serialization hooks", async () => {
  const { executor, calls } = harness();
  let toJsonCalled = false;
  const maliciousInput = Object.create({ inherited: true });
  maliciousInput.dealId = "deal-1";
  maliciousInput.value = 100;
  maliciousInput.toJSON = () => {
    toJsonCalled = true;
    return { ...input, workspaceId: "tenant-b" };
  };

  await expectCode(
    executor.execute({
      actionId: "crm.deal.update",
      context: baseContext,
      input: maliciousInput,
      idempotencyKey: "custom-serialization",
    }),
    "UNSAFE_PAYLOAD_OBJECT",
  );
  assert.equal(toJsonCalled, false);
  assert.equal(calls.length, 0);
});

test("revalidates validator-transformed input for tenant ownership fields", async () => {
  const { executor, calls } = harness({
    inputValidator: (value) => ({ ...value, workspaceId: "tenant-b" }),
  });
  await expectCode(
    executor.execute({
      actionId: "crm.deal.update",
      context: baseContext,
      input,
      idempotencyKey: "validator-tenant-injection",
    }),
    "TENANT_OVERRIDE_FORBIDDEN",
  );
  assert.equal(calls.length, 0);
});


test("preflight shares authorization but only requests consent: no receipt, consumption or side effects", async () => {
  let requested = 0, consumed = 0, authority = true;
  const receipts = createMemoryReceiptStore();
  const h = harness({ risk: "HIGH", receiptStore: receipts, authorizer: async () => authority,
    approvalStore: { async request(q) { requested++; assert.equal(q.digest, digest); return {id:"approval-pre",status:"PENDING"}; }, async consume() { consumed++; } } });
  const request = { actionId:"crm.deal.update", context:baseContext, input, idempotencyKey:"same-preflight" };
  const prepared = await h.executor.preflight(request);
  assert.equal(prepared.requiresApproval, true); assert.equal(prepared.status,"PENDING");
  assert.equal(requested,1); assert.equal(consumed,0); assert.equal(h.calls.length,0);
  assert.deepEqual(receipts.snapshot(),[]);
  authority = false;
  await expectCode(h.executor.preflight(request),"ACTION_FORBIDDEN");
  await expectCode(h.executor.execute(request),"ACTION_FORBIDDEN");
  assert.equal(requested,1);
});

test("preflight cannot grant authority, skip policy or silently use missing approval persistence", async () => {
  const request = {actionId:"crm.deal.update",context:baseContext,input,idempotencyKey:"preflight"};
  const plain = harness();
  assert.equal((await plain.executor.preflight(request)).requiresApproval,false);
  assert.equal(plain.calls.length,0);
  await expectCode(harness({risk:"HIGH"}).executor.preflight(request),"APPROVAL_REQUIRED");
  await expectCode(harness({policyEvaluator:async()=>({allowed:false})}).executor.preflight(request),"ACTION_POLICY_DENIED");
  const aborted=new AbortController(); aborted.abort();
  await assert.rejects(plain.executor.preflight(request,{signal:aborted.signal}));
  await assert.rejects(plain.executor.preflight({...request,input:{...input,tenantId:"evil"}}));
});
