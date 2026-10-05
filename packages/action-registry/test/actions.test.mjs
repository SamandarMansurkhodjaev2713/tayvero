import assert from "node:assert/strict";
import test from "node:test";
import { ActionRegistryError, createActionCatalog, createActionRegistry } from "../src/index.mjs";

const inputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["dealId"],
  properties: { dealId: { type: "string", minLength: 1 } },
};
const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
};

function manifest(overrides = {}) {
  return {
    id: "crm.deal.update",
    version: "1",
    risk: "MEDIUM",
    mutating: true,
    permissions: ["crm.deal.update"],
    idempotency: "KEYED",
    timeoutMs: 5_000,
    retry: { attempts: 1, baseDelayMs: 10 },
    inputSchema,
    outputSchema,
    ...overrides,
  };
}

function expectCode(callback, code) {
  assert.throws(
    callback,
    (error) => error instanceof ActionRegistryError && error.code === code,
  );
}

test("registers immutable typed action entries without exposing a direct execution path", () => {
  const executor = async () => ({ ok: true });
  const registry = createActionRegistry().register(manifest(), executor);

  assert.equal(registry.size, 1);
  assert.equal(registry.has("crm.deal.update"), true);
  assert.equal(registry.get("crm.deal.update"), registry.resolve("crm.deal.update"));
  assert.equal(registry.getAction("crm.deal.update").executor, executor);
  assert.equal(registry.execute, undefined);
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(Object.isFrozen(registry.get("crm.deal.update")), true);
  assert.equal(Object.isFrozen(registry.get("crm.deal.update").manifest), true);
});

test("normalizes legacy risk and idempotency vocabulary into the governed runtime contract", () => {
  const read = createActionCatalog().register(
    manifest({
      id: "crm.deal.read",
      risk: "READ",
      readOnly: true,
      mutating: undefined,
      idempotency: "NONE",
      permissions: ["crm.deal.read"],
    }),
    async () => ({ ok: true }),
  ).get("crm.deal.read").manifest;

  assert.equal(read.risk, "LOW");
  assert.equal(read.mutating, false);
  assert.equal(read.readOnly, true);

  const write = createActionCatalog().register(
    manifest({ risk: "WRITE", idempotency: "REQUIRED" }),
    async () => ({ ok: true }),
  ).get("crm.deal.update").manifest;

  assert.equal(write.risk, "MEDIUM");
  assert.equal(write.idempotency, "KEYED");
});

test("converts JSON schemas into runtime validators", () => {
  const entry = createActionRegistry()
    .register(manifest(), async () => ({ ok: true }))
    .get("crm.deal.update");

  assert.deepEqual(entry.manifest.inputValidator({ dealId: "deal-1" }), { dealId: "deal-1" });
  expectCode(() => entry.manifest.inputValidator({}), "SCHEMA_REQUIRED");
  assert.deepEqual(entry.manifest.outputValidator({ ok: true }), { ok: true });
  expectCode(() => entry.manifest.outputValidator({ ok: "yes" }), "SCHEMA_TYPE");
});

test("defensively snapshots schemas, metadata, permissions and retry configuration", () => {
  const mutableInputSchema = structuredClone(inputSchema);
  const mutablePermissions = ["crm.deal.update"];
  const mutableRetry = { attempts: 1, baseDelayMs: 10 };
  const mutableMetadata = { channel: { name: "crm" } };

  const registry = createActionRegistry().register(
    manifest({
      inputSchema: mutableInputSchema,
      permissions: mutablePermissions,
      retry: mutableRetry,
      metadata: mutableMetadata,
    }),
    async () => ({ ok: true }),
  );
  const registered = registry.get("crm.deal.update").manifest;

  mutableInputSchema.required.length = 0;
  mutablePermissions.push("*");
  mutableRetry.attempts = 5;
  mutableMetadata.channel.name = "tampered";

  assert.deepEqual(registered.inputSchema.required, ["dealId"]);
  assert.deepEqual(registered.permissions, ["crm.deal.update"]);
  assert.equal(registered.retry.attempts, 1);
  assert.equal(registered.metadata.channel.name, "crm");
  assert.equal(Object.isFrozen(registered.inputSchema), true);
  assert.equal(Object.isFrozen(registered.metadata.channel), true);
});

test("rejects duplicate action identifiers", () => {
  const registry = createActionRegistry().register(manifest(), async () => ({ ok: true }));
  expectCode(() => registry.register(manifest(), async () => ({ ok: true })), "DUPLICATE_ACTION");
});

test("rejects execution-state options because execution belongs to the governed runtime", () => {
  expectCode(
    () => createActionRegistry({ state: {}, approvalSecret: "secret" }),
    "LEGACY_EXECUTION_OPTIONS_FORBIDDEN",
  );
});

test("rejects a mutating manifest without idempotency", () => {
  expectCode(
    () => createActionRegistry().register(manifest({ idempotency: "NONE" }), async () => ({ ok: true })),
    "UNSAFE_IDEMPOTENCY_POLICY",
  );
});

test("rejects manifests without explicit permissions", () => {
  expectCode(
    () => createActionRegistry().register(manifest({ permissions: [] }), async () => ({ ok: true })),
    "INVALID_ACTION_PERMISSIONS",
  );
});

test("rejects unsafe retry policies for mutating actions", () => {
  expectCode(
    () => createActionRegistry().register(
      manifest({ retry: { attempts: 2, baseDelayMs: 10 }, retrySafe: false }),
      async () => ({ ok: true }),
    ),
    "UNSAFE_RETRY_POLICY",
  );
});

test("rejects non-integer and non-finite retry configuration", () => {
  for (const attempts of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, 0, 6]) {
    expectCode(
      () => createActionRegistry().register(
        manifest({ retry: { attempts, baseDelayMs: 10 } }),
        async () => ({ ok: true }),
      ),
      "INVALID_MANIFEST",
    );
  }
});

test("registerMany accepts tuple and entry forms and returns stable sorted manifests", () => {
  const readManifest = manifest({
    id: "crm.company.read",
    risk: "LOW",
    mutating: false,
    idempotency: "NONE",
    permissions: ["crm.company.read"],
  });
  const registry = createActionRegistry({
    entries: [
      { manifest: manifest(), executor: async () => ({ ok: true }) },
      [readManifest, async () => ({ ok: true })],
    ],
  });

  assert.deepEqual(registry.list().map((item) => item.id), ["crm.company.read", "crm.deal.update"]);
});

test("requires own properties instead of inherited prototype properties", () => {
  const registry = createActionRegistry().register(
    manifest({
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["toString"],
        properties: { toString: { type: "string" } },
      },
    }),
    async () => ({ ok: true }),
  );
  expectCode(() => registry.get("crm.deal.update").manifest.inputValidator({}), "SCHEMA_REQUIRED");
});

test("rejects unsafe JSON-schema and metadata object keys", () => {
  const unsafeSchema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}');
  expectCode(
    () => createActionRegistry().register(manifest({ inputSchema: unsafeSchema }), async () => ({ ok: true })),
    "INVALID_MANIFEST_METADATA",
  );
});
