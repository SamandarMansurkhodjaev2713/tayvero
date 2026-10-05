import { createHash } from "node:crypto";
import { securityError } from "./errors.mjs";

const IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f]{1,256}$/;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function requireIdentifier(value, field, maxLength = 128) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || !IDENTIFIER_PATTERN.test(value)) {
    throw securityError("TENANT_CONTEXT_INVALID", `${field} is invalid`, {
      safeDetails: { field },
    });
  }
  return value;
}

function requirePlainRecord(value, field) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw securityError("TENANT_ARGUMENT_INVALID", `${field} must be an object`, {
      safeDetails: { field },
    });
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw securityError("TENANT_ARGUMENT_INVALID", `${field} must be a plain object`, {
      safeDetails: { field },
    });
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) {
      throw securityError("TENANT_ARGUMENT_INVALID", `${field} contains a dangerous key`, {
        safeDetails: { field, key },
      });
    }
    result[key] = entry;
  }
  return result;
}

function tenantValueFromContext(context, tenantField) {
  if (!context || typeof context !== "object") {
    throw securityError("TENANT_CONTEXT_INVALID", "Tenant context is required");
  }
  const tenantId = context.tenantId ?? context.workspaceId ?? context.organizationId;
  return requireIdentifier(tenantId, "tenantId", 128);
}

export function createTenantContext({
  tenantId,
  actorId,
  actorType = "user",
  roles = [],
  requestId,
}) {
  if (!Array.isArray(roles) || roles.some((role) => typeof role !== "string" || role.length === 0 || role.length > 128)) {
    throw securityError("TENANT_CONTEXT_INVALID", "roles must be an array of non-empty strings");
  }
  return Object.freeze({
    tenantId: requireIdentifier(tenantId, "tenantId", 128),
    actorId: requireIdentifier(actorId, "actorId", 256),
    actorType: requireIdentifier(actorType, "actorType", 64),
    roles: Object.freeze([...new Set(roles)]),
    requestId: requestId == null ? undefined : requireIdentifier(requestId, "requestId", 256),
  });
}

export function scopeTenantWhere(context, where = {}, tenantField = "workspaceId") {
  const safeWhere = requirePlainRecord(where, "where");
  const tenantId = tenantValueFromContext(context, tenantField);
  if (Object.hasOwn(safeWhere, tenantField)) {
    const supplied = safeWhere[tenantField];
    if (supplied !== tenantId) {
      throw securityError("TENANT_SCOPE_MISMATCH", "Tenant selector does not match the active context", {
        safeDetails: { tenantField },
      });
    }
  }
  return { ...safeWhere, [tenantField]: tenantId };
}

export function scopeTenantUniqueWhere(context, where, tenantField = "workspaceId") {
  const safeWhere = requirePlainRecord(where, "where");
  const selectorKeys = Object.keys(safeWhere).filter((key) => key !== tenantField);
  if (selectorKeys.length === 0) {
    throw securityError("TENANT_UNIQUE_SELECTOR_REQUIRED", "A unique selector is required");
  }
  return scopeTenantWhere(context, safeWhere, tenantField);
}

export function scopeTenantCreateData(context, data, tenantField = "workspaceId") {
  const safeData = requirePlainRecord(data, "data");
  const tenantId = tenantValueFromContext(context, tenantField);
  if (Object.hasOwn(safeData, tenantField) && safeData[tenantField] !== tenantId) {
    throw securityError("TENANT_SCOPE_MISMATCH", "Create payload tenant does not match the active context", {
      safeDetails: { tenantField },
    });
  }
  return { ...safeData, [tenantField]: tenantId };
}

export function scopeTenantCreateManyData(context, data, tenantField = "workspaceId") {
  const entries = Array.isArray(data) ? data : [data];
  if (entries.length === 0) return [];
  return entries.map((entry) => scopeTenantCreateData(context, entry, tenantField));
}

export function scopeTenantUpdateData(data, tenantField = "workspaceId") {
  const safeData = requirePlainRecord(data, "data");
  if (Object.hasOwn(safeData, tenantField)) {
    throw securityError("TENANT_REASSIGNMENT_FORBIDDEN", "Tenant ownership cannot be changed by a scoped update", {
      safeDetails: { tenantField },
    });
  }
  return safeData;
}

export function assertTenantOwnedResult(context, result, tenantField = "workspaceId") {
  const tenantId = tenantValueFromContext(context, tenantField);
  const values = Array.isArray(result) ? result : result == null ? [] : [result];
  for (const value of values) {
    if (!value || typeof value !== "object" || value[tenantField] !== tenantId) {
      throw securityError("TENANT_BOUNDARY_BREACH", "A tenant boundary invariant was violated", {
        safeDetails: { tenantField },
      });
    }
  }
  return result;
}

export function tenantScopedIdempotencyKey(context, namespace, parts = []) {
  const tenantId = tenantValueFromContext(context, "tenantId");
  const safeNamespace = requireIdentifier(namespace, "namespace", 128);
  if (!Array.isArray(parts) || parts.length > 32) {
    throw securityError("TENANT_IDEMPOTENCY_INVALID", "Idempotency parts are invalid");
  }
  const normalizedParts = parts.map((part, index) => requireIdentifier(String(part), `parts[${index}]`, 512));
  return createHash("sha256")
    .update(JSON.stringify(["tenant-idempotency-v1", tenantId, safeNamespace, ...normalizedParts]), "utf8")
    .digest("hex");
}

function requireDelegateMethod(delegate, method) {
  if (!delegate || typeof delegate[method] !== "function") {
    throw securityError("TENANT_DELEGATE_INVALID", `Tenant delegate does not support ${method}`, {
      safeDetails: { method },
    });
  }
  return delegate[method].bind(delegate);
}

function prepareVerificationProjection(args, tenantField) {
  const safeArgs = requirePlainRecord(args, "args");
  let stripTenantField = false;

  if (safeArgs.select !== undefined) {
    const select = requirePlainRecord(safeArgs.select, "select");
    if (select[tenantField] !== true) {
      safeArgs.select = { ...select, [tenantField]: true };
      stripTenantField = true;
    }
  }

  if (safeArgs.omit !== undefined) {
    const omit = requirePlainRecord(safeArgs.omit, "omit");
    if (omit[tenantField] === true) {
      safeArgs.omit = { ...omit, [tenantField]: false };
      stripTenantField = true;
    }
  }

  return { args: safeArgs, stripTenantField };
}

function verifyAndRestoreProjection(context, result, tenantField, stripTenantField) {
  assertTenantOwnedResult(context, result, tenantField);
  if (!stripTenantField || result == null) return result;

  const strip = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const copy = { ...value };
    delete copy[tenantField];
    return copy;
  };
  return Array.isArray(result) ? result.map(strip) : strip(result);
}

export function createTenantScopedDelegate({ delegate, context, tenantField = "workspaceId" }) {
  requireIdentifier(tenantField, "tenantField", 128);

  const executeAndVerify = async (method, args, stripTenantField) => {
    const result = await requireDelegateMethod(delegate, method)(args);
    return verifyAndRestoreProjection(context, result, tenantField, stripTenantField);
  };

  const api = {
    async findMany(args = {}) {
      const projection = prepareVerificationProjection(args, tenantField);
      const safeArgs = projection.args;
      return executeAndVerify(
        "findMany",
        { ...safeArgs, where: scopeTenantWhere(context, safeArgs.where, tenantField) },
        projection.stripTenantField,
      );
    },

    async findFirst(args = {}) {
      const projection = prepareVerificationProjection(args, tenantField);
      const safeArgs = projection.args;
      return executeAndVerify(
        "findFirst",
        { ...safeArgs, where: scopeTenantWhere(context, safeArgs.where, tenantField) },
        projection.stripTenantField,
      );
    },

    async findUniqueBy(where, args = {}) {
      const projection = prepareVerificationProjection(args, tenantField);
      return executeAndVerify(
        "findUnique",
        { ...projection.args, where: scopeTenantUniqueWhere(context, where, tenantField) },
        projection.stripTenantField,
      );
    },

    async count(args = {}) {
      const safeArgs = requirePlainRecord(args, "args");
      return requireDelegateMethod(delegate, "count")({
        ...safeArgs,
        where: scopeTenantWhere(context, safeArgs.where, tenantField),
      });
    },

    async create(args) {
      const projection = prepareVerificationProjection(args, tenantField);
      const safeArgs = projection.args;
      return executeAndVerify(
        "create",
        { ...safeArgs, data: scopeTenantCreateData(context, safeArgs.data, tenantField) },
        projection.stripTenantField,
      );
    },

    async createMany(args) {
      const safeArgs = requirePlainRecord(args, "args");
      return requireDelegateMethod(delegate, "createMany")({
        ...safeArgs,
        data: scopeTenantCreateManyData(context, safeArgs.data, tenantField),
      });
    },

    async updateMany(args) {
      const safeArgs = requirePlainRecord(args, "args");
      return requireDelegateMethod(delegate, "updateMany")({
        ...safeArgs,
        where: scopeTenantWhere(context, safeArgs.where, tenantField),
        data: scopeTenantUpdateData(safeArgs.data, tenantField),
      });
    },

    async updateBy(where, args) {
      const projection = prepareVerificationProjection(args, tenantField);
      const safeArgs = projection.args;
      return executeAndVerify(
        "update",
        {
          ...safeArgs,
          where: scopeTenantUniqueWhere(context, where, tenantField),
          data: scopeTenantUpdateData(safeArgs.data, tenantField),
        },
        projection.stripTenantField,
      );
    },

    async deleteMany(args = {}) {
      const safeArgs = requirePlainRecord(args, "args");
      return requireDelegateMethod(delegate, "deleteMany")({
        ...safeArgs,
        where: scopeTenantWhere(context, safeArgs.where, tenantField),
      });
    },

    async deleteBy(where, args = {}) {
      const projection = prepareVerificationProjection(args, tenantField);
      return executeAndVerify(
        "delete",
        { ...projection.args, where: scopeTenantUniqueWhere(context, where, tenantField) },
        projection.stripTenantField,
      );
    },

    async upsertBy(where, args) {
      const projection = prepareVerificationProjection(args, tenantField);
      const safeArgs = projection.args;
      return executeAndVerify(
        "upsert",
        {
          ...safeArgs,
          where: scopeTenantUniqueWhere(context, where, tenantField),
          create: scopeTenantCreateData(context, safeArgs.create, tenantField),
          update: scopeTenantUpdateData(safeArgs.update, tenantField),
        },
        projection.stripTenantField,
      );
    },
  };
  return Object.freeze(api);
}

