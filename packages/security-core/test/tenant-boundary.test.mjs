import assert from "node:assert/strict";
import test from "node:test";
import {
  createTenantContext,
  createTenantScopedDelegate,
  scopeTenantCreateData,
  scopeTenantUniqueWhere,
  scopeTenantUpdateData,
  scopeTenantWhere,
  tenantScopedIdempotencyKey,
} from "../src/index.mjs";

const tenantA = createTenantContext({ tenantId: "tenant-a", actorId: "user-a", roles: ["member"] });
const tenantB = createTenantContext({ tenantId: "tenant-b", actorId: "user-b", roles: ["member"] });

test("givenUnscopedWhere_whenScoping_thenInjectsActiveTenant", () => {
  assert.deepEqual(scopeTenantWhere(tenantA, { status: "OPEN" }), {
    status: "OPEN",
    workspaceId: "tenant-a",
  });
});

test("givenCrossTenantSelector_whenScoping_thenRejects", () => {
  assert.throws(
    () => scopeTenantWhere(tenantA, { workspaceId: "tenant-b" }),
    (error) => error.code === "TENANT_SCOPE_MISMATCH",
  );
});

test("givenCreatePayloadForAnotherTenant_whenScoping_thenRejects", () => {
  assert.throws(
    () => scopeTenantCreateData(tenantA, { name: "Acme", workspaceId: "tenant-b" }),
    (error) => error.code === "TENANT_SCOPE_MISMATCH",
  );
});

test("givenAttemptedTenantReassignment_whenUpdating_thenRejects", () => {
  assert.throws(
    () => scopeTenantUpdateData({ workspaceId: "tenant-b", name: "Acme" }),
    (error) => error.code === "TENANT_REASSIGNMENT_FORBIDDEN",
  );
});

test("givenUniqueSelector_whenScoping_thenKeepsUniqueFieldAndAddsTenant", () => {
  assert.deepEqual(scopeTenantUniqueWhere(tenantA, { id: "record-1" }), {
    id: "record-1",
    workspaceId: "tenant-a",
  });
});

test("givenSameOperationInDifferentTenants_whenBuildingIdempotencyKey_thenKeysDiffer", () => {
  const keyA = tenantScopedIdempotencyKey(tenantA, "deal.update", ["deal-1", "request-1"]);
  const keyB = tenantScopedIdempotencyKey(tenantB, "deal.update", ["deal-1", "request-1"]);
  assert.match(keyA, /^[a-f0-9]{64}$/);
  assert.notEqual(keyA, keyB);
});

test("givenTenantScopedDelegate_whenReading_thenAlwaysInjectsTenantAndValidatesResults", async () => {
  const calls = [];
  const delegate = {
    async findMany(args) {
      calls.push(args);
      return [{ id: "1", workspaceId: "tenant-a" }];
    },
  };
  const scoped = createTenantScopedDelegate({ delegate, context: tenantA });
  const result = await scoped.findMany({ where: { status: "OPEN" } });
  assert.deepEqual(calls[0].where, { status: "OPEN", workspaceId: "tenant-a" });
  assert.equal(result.length, 1);
});

test("givenCompromisedDelegateReturningAnotherTenant_whenReading_thenFailsClosed", async () => {
  const delegate = {
    async findMany() {
      return [{ id: "1", workspaceId: "tenant-b" }];
    },
  };
  const scoped = createTenantScopedDelegate({ delegate, context: tenantA });
  await assert.rejects(scoped.findMany(), (error) => error.code === "TENANT_BOUNDARY_BREACH");
});

test("givenScopedMutation_whenUpdating_thenScopesWhereAndForbidsOwnershipChange", async () => {
  const calls = [];
  const delegate = {
    async update(args) {
      calls.push(args);
      return { id: args.where.id, workspaceId: args.where.workspaceId, name: args.data.name };
    },
  };
  const scoped = createTenantScopedDelegate({ delegate, context: tenantA });
  const result = await scoped.updateBy({ id: "record-1" }, { data: { name: "Updated" } });
  assert.deepEqual(calls[0], {
    where: { id: "record-1", workspaceId: "tenant-a" },
    data: { name: "Updated" },
  });
  assert.equal(result.workspaceId, "tenant-a");
  await assert.rejects(
    scoped.updateBy({ id: "record-1" }, { data: { workspaceId: "tenant-b" } }),
    (error) => error.code === "TENANT_REASSIGNMENT_FORBIDDEN",
  );
});

test("givenPrototypePollutionKey_whenScoping_thenRejectsInput", () => {
  const malicious = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => scopeTenantWhere(tenantA, malicious), (error) => error.code === "TENANT_ARGUMENT_INVALID");
  assert.equal({}.polluted, undefined);
});


test("givenCallerSelectExcludesTenantField_whenReading_thenVerifiesInternallyAndRestoresRequestedShape", async () => {
  const calls = [];
  const delegate = {
    async findMany(args) {
      calls.push(args);
      return [{ id: "1", workspaceId: "tenant-a" }];
    },
  };
  const scoped = createTenantScopedDelegate({ delegate, context: tenantA });
  const result = await scoped.findMany({ select: { id: true } });
  assert.deepEqual(calls[0].select, { id: true, workspaceId: true });
  assert.deepEqual(result, [{ id: "1" }]);
});
