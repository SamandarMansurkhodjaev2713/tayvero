import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

const FORBIDDEN_TENANT_KEYS = new Set(["tenantId", "workspaceId", "organizationId", "orgId"]);
const SECRET_KEY_PATTERN = /(authorization|cookie|token|secret|password|api[-_]?key|private[-_]?key|credential)/i;
const ALLOWED_RISK = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const ALLOWED_IDEMPOTENCY = new Set(["NONE", "KEYED", "INHERENT"]);
const ACTION_ID_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PERMISSION_PATTERN = /^(?:\*|[a-z][a-z0-9_.:-]{0,127})$/;
const ALLOWED_REQUEST_KEYS = new Set(["actionId", "approvalId", "context", "idempotencyKey", "input"]);
const ALLOWED_EXECUTION_OPTION_KEYS = new Set(["signal"]);
const SECRET_VALUE_PATTERNS = [
  /^Bearer\s+\S+$/i,
  /^sk-[A-Za-z0-9_-]{16,}$/,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

export class GovernedActionError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "GovernedActionError";
    this.code = code;
    this.retryable = options.retryable === true;
    this.sideEffect = options.sideEffect ?? "UNKNOWN";
    this.safeDetails = options.safeDetails ?? undefined;
  }
}

function assertRecord(value, code, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GovernedActionError(code, message);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new GovernedActionError(code, message);
  }
  return value;
}

function assertNonEmptyString(value, code, field, max = 512) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw new GovernedActionError(code, `${field} must be a non-empty string no longer than ${max} characters`);
  }
  return value;
}

const JSON_LIMITS = Object.freeze({ depth: 40, nodes: 20_000, characters: 1_000_000 });

/** Snapshot plain bounded JSON without invoking getters or serialization hooks. */
function cloneJson(value, path = "$", state = { seen: new Set(), nodes: 0, characters: 0 }, depth = 0, canonical = false) {
  state.nodes += 1;
  if (depth > JSON_LIMITS.depth || state.nodes > JSON_LIMITS.nodes) throw new GovernedActionError("ACTION_DATA_LIMIT", "Action data exceeds nesting or node limits");
  if (value === undefined && path === "$" && !canonical) return undefined;
  if (typeof value === "string") {
    state.characters += value.length;
    if (state.characters > JSON_LIMITS.characters) throw new GovernedActionError("ACTION_DATA_LIMIT", "Action data exceeds the character limit");
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new GovernedActionError("INVALID_NUMBER", `Non-finite number at ${path}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") throw new GovernedActionError("NON_JSON_VALUE", `Unsupported JSON value at ${path}`);
  if (state.seen.has(value)) throw new GovernedActionError("CYCLIC_PAYLOAD", `Cyclic action data at ${path}`);
  const array = Array.isArray(value);
  if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new GovernedActionError("UNSAFE_PAYLOAD_OBJECT", `Only plain JSON objects are allowed at ${path}`);
  if (Object.getOwnPropertySymbols(value).length) throw new GovernedActionError("NON_JSON_VALUE", "Symbol properties are not JSON data");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(value);
  if (keys.length > JSON_LIMITS.nodes - state.nodes || (array && value.length > JSON_LIMITS.nodes - state.nodes)) throw new GovernedActionError("ACTION_DATA_LIMIT", "Action container exceeds the node limit");
  for (const key of Object.keys(descriptors)) {
    if (!Object.hasOwn(descriptors[key], "value")) throw new GovernedActionError("UNSAFE_PAYLOAD_ACCESSOR", "Accessor properties are not accepted in action data");
  }
  state.seen.add(value);
  try {
    if (array) {
      const result = [];
      if (keys.some(key => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw new GovernedActionError("NON_JSON_VALUE", "Array metadata is not accepted");
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(descriptors, index)) throw new GovernedActionError("NON_JSON_VALUE", "Sparse arrays are not accepted");
        result.push(cloneJson(descriptors[index].value, `${path}[${index}]`, state, depth + 1, canonical));
      }
      return result;
    }
    const result = {};
    for (const key of canonical ? keys.sort() : keys) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new GovernedActionError("UNSAFE_OBJECT_KEY", `Unsafe object key at ${path}.${key}`);
      state.characters += key.length;
      if (state.characters > JSON_LIMITS.characters) throw new GovernedActionError("ACTION_DATA_LIMIT", "Action keys exceed the character limit");
      const child = descriptors[key].value;
      // Preserve the existing canonical identity for optional object fields.
      if (canonical && child === undefined) continue;
      Object.defineProperty(result, key, { configurable: true, enumerable: true, writable: true, value: cloneJson(child, `${path}.${key}`, state, depth + 1, canonical) });
    }
    return result;
  } finally { state.seen.delete(value); }
}


function deepFreezeJson(value, seen = new Set()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) throw new GovernedActionError("CYCLIC_PAYLOAD", "Cyclic action data is not allowed");
  seen.add(value);
  for (const child of Object.values(value)) deepFreezeJson(child, seen);
  seen.delete(value);
  return Object.freeze(value);
}

function assertValidDate(value, code, field) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new GovernedActionError(code, `${field} must be a valid Date`);
  }
  return value;
}

function readClock(clock) {
  let value;
  try {
    value = clock();
  } catch (cause) {
    throw new GovernedActionError("INVALID_CLOCK", "The runtime clock failed", { cause });
  }
  const date = assertValidDate(value, "INVALID_CLOCK", "clock result");
  return new Date(date.getTime());
}

function assertAbortSignal(value) {
  if (value === undefined) return undefined;
  if (
    value === null
    || typeof value !== "object"
    || typeof value.aborted !== "boolean"
    || typeof value.addEventListener !== "function"
    || typeof value.removeEventListener !== "function"
  ) {
    throw new GovernedActionError("INVALID_ACTION_OPTIONS", "signal must implement the AbortSignal contract");
  }
  return value;
}


function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof GovernedActionError) throw reason;
  throw new GovernedActionError("ACTION_CANCELLED", "Action was cancelled", {
    cause: reason,
    sideEffect: "NOT_STARTED",
  });
}

function assertKnownKeys(value, allowed, code, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new GovernedActionError(code, `${label} contains unsupported fields`, { safeDetails: { fields: unknown.sort() } });
  }
}

export function canonicalJson(value) {
  return JSON.stringify(cloneJson(value, "$", { seen: new Set(), nodes: 0, characters: 0 }, 0, true));
}

export function sha256Hex(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

export function assertNoTenantOverride(value, path = "input", seen = new Set()) {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new GovernedActionError("CYCLIC_PAYLOAD", `Cyclic payload at ${path}`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoTenantOverride(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_TENANT_KEYS.has(key)) {
        throw new GovernedActionError("TENANT_OVERRIDE_FORBIDDEN", `Tenant ownership field is forbidden at ${path}.${key}`);
      }
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new GovernedActionError("UNSAFE_OBJECT_KEY", `Unsafe object key at ${path}.${key}`);
      }
      assertNoTenantOverride(child, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

export function redactForAudit(value, depth = 0, seen = new Set()) {
  if (depth > 8) return "[MAX_DEPTH]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) return "[REDACTED]";
    return value.length > 2048 ? `${value.slice(0, 2048)}…[TRUNCATED]` : value;
  }
  if (typeof value !== "object") return `[${typeof value}]`;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.slice(0, 100).map((item) => redactForAudit(item, depth + 1, seen));
    if (value.length > 100) result.push(`[${value.length - 100} MORE]`);
    seen.delete(value);
    return result;
  }
  const result = {};
  for (const [key, child] of Object.entries(value).slice(0, 200)) {
    // Define an own data property instead of invoking Object.prototype.__proto__
    // when an untrusted executor result contains that key.
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactForAudit(child, depth + 1, seen),
      writable: true,
    });
  }
  seen.delete(value);
  return result;
}

function resolveRegistryEntry(registry, actionId) {
  if (registry instanceof Map) return registry.get(actionId);
  if (typeof registry?.get === "function") return registry.get(actionId);
  if (typeof registry?.resolve === "function") return registry.resolve(actionId);
  if (typeof registry?.getAction === "function") return registry.getAction(actionId);
  throw new GovernedActionError(
    "INVALID_REGISTRY",
    "The action registry must expose get, resolve or getAction; plain object registries are not accepted",
  );
}

function validateWith(candidate, value, label) {
  if (!candidate) return value;
  if (typeof candidate === "function") {
    try {
      const result = candidate(value);
      if (result === false) throw new GovernedActionError("SCHEMA_VALIDATION_FAILED", `${label} validation failed`);
      return result === true || result === undefined ? value : result;
    } catch (cause) {
      if (cause instanceof GovernedActionError) throw cause;
      throw new GovernedActionError("SCHEMA_VALIDATION_FAILED", `${label} validation failed`, { cause });
    }
  }
  if (typeof candidate.safeParse === "function") {
    const result = candidate.safeParse(value);
    if (!result?.success) throw new GovernedActionError("SCHEMA_VALIDATION_FAILED", `${label} validation failed`, { safeDetails: result?.error?.issues });
    return result.data;
  }
  if (typeof candidate.parse === "function") {
    try { return candidate.parse(value); }
    catch (cause) { throw new GovernedActionError("SCHEMA_VALIDATION_FAILED", `${label} validation failed`, { cause }); }
  }
  throw new GovernedActionError("INVALID_SCHEMA_ADAPTER", `${label} validator is unsupported`);
}

function normalizeManifest(entry, actionId) {
  const manifest = entry?.manifest ?? entry;
  assertRecord(manifest, "ACTION_NOT_FOUND", `Action ${actionId} is not registered`);

  const id = assertNonEmptyString(manifest.id ?? manifest.actionId ?? actionId, "INVALID_MANIFEST", "manifest.id", 128);
  if (!ACTION_ID_PATTERN.test(id)) throw new GovernedActionError("INVALID_MANIFEST", "manifest.id has an invalid format");
  if (id !== actionId) throw new GovernedActionError("MANIFEST_ID_MISMATCH", "Resolved action manifest does not match requested action");

  const version = assertNonEmptyString(String(manifest.version ?? "1"), "INVALID_MANIFEST", "manifest.version", 64);
  if (!VERSION_PATTERN.test(version)) throw new GovernedActionError("INVALID_MANIFEST", "manifest.version has an invalid format");

  const risk = String(manifest.risk ?? manifest.riskLevel ?? "MEDIUM").toUpperCase();
  if (!ALLOWED_RISK.has(risk)) throw new GovernedActionError("INVALID_MANIFEST", `Unsupported risk level ${risk}`);
  const mutating = manifest.mutating !== false && manifest.readOnly !== true;
  if (manifest.mutating === true && manifest.readOnly === true) {
    throw new GovernedActionError("INVALID_MANIFEST", "readOnly and mutating cannot both be true");
  }

  const idempotency = String(manifest.idempotency ?? (mutating ? "KEYED" : "NONE")).toUpperCase();
  if (!ALLOWED_IDEMPOTENCY.has(idempotency)) throw new GovernedActionError("INVALID_MANIFEST", `Unsupported idempotency mode ${idempotency}`);
  if (mutating && idempotency === "NONE") {
    throw new GovernedActionError("INVALID_MANIFEST", "Mutating actions must use KEYED or INHERENT idempotency");
  }

  const rawPermissions = Array.isArray(manifest.permissions)
    ? manifest.permissions
    : manifest.permission
      ? [manifest.permission]
      : [];
  if (rawPermissions.length === 0) throw new GovernedActionError("INVALID_MANIFEST", "At least one explicit action permission is required");
  const permissions = [];
  const seenPermissions = new Set();
  for (const rawPermission of rawPermissions) {
    const permission = assertNonEmptyString(String(rawPermission), "INVALID_MANIFEST", "manifest.permissions[]", 128);
    if (!PERMISSION_PATTERN.test(permission)) throw new GovernedActionError("INVALID_MANIFEST", `Invalid action permission ${permission}`);
    if (!seenPermissions.has(permission)) {
      seenPermissions.add(permission);
      permissions.push(permission);
    }
  }

  const timeoutMs = manifest.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new GovernedActionError("INVALID_MANIFEST", "timeoutMs must be an integer from 1 to 120000");
  }
  const retryConfig = manifest.retry ?? {};
  assertRecord(retryConfig, "INVALID_MANIFEST", "manifest.retry must be an object");
  const attempts = retryConfig.attempts ?? 1;
  const baseDelayMs = retryConfig.baseDelayMs ?? 100;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) {
    throw new GovernedActionError("INVALID_MANIFEST", "retry.attempts must be an integer from 1 to 5");
  }
  if (!Number.isInteger(baseDelayMs) || baseDelayMs < 0 || baseDelayMs > 5_000) {
    throw new GovernedActionError("INVALID_MANIFEST", "retry.baseDelayMs must be an integer from 0 to 5000");
  }

  const retrySafe = !mutating || manifest.retrySafe === true;
  if (attempts > 1 && !retrySafe) {
    throw new GovernedActionError("INVALID_MANIFEST", "A mutating action may retry only when retrySafe is explicitly true");
  }
  if (attempts > 1 && idempotency === "NONE") {
    throw new GovernedActionError("INVALID_MANIFEST", "Retrying an action requires idempotency");
  }

  const inputValidator = manifest.inputValidator ?? manifest.inputSchema;
  const outputValidator = manifest.outputValidator ?? manifest.outputSchema;
  for (const [label, validator] of [["input", inputValidator], ["output", outputValidator]]) {
    const supported = typeof validator === "function"
      || typeof validator?.safeParse === "function"
      || typeof validator?.parse === "function";
    if (!supported) throw new GovernedActionError("INVALID_MANIFEST", `${label} validator is required and must be supported`);
  }

  const executor = entry?.execute ?? entry?.executor ?? manifest.execute ?? manifest.executor;
  if (typeof executor !== "function") throw new GovernedActionError("ACTION_EXECUTOR_MISSING", `Action ${actionId} has no executor`);
  if (manifest.businessValidator !== undefined && typeof manifest.businessValidator !== "function") {
    throw new GovernedActionError("INVALID_MANIFEST", "businessValidator must be a function");
  }

  return Object.freeze({
    id,
    version,
    title: typeof manifest.title === "string" ? manifest.title.slice(0, 160) : id,
    risk,
    mutating,
    idempotency,
    permissions: Object.freeze(permissions),
    timeoutMs,
    inputValidator,
    outputValidator,
    retrySafe,
    businessValidator: manifest.businessValidator,
    executor,
    retry: Object.freeze({ attempts, baseDelayMs }),
  });
}

function normalizeContext(context) {
  assertRecord(context, "TRUSTED_CONTEXT_REQUIRED", "Trusted execution context is required");
  const tenantId = assertNonEmptyString(context.tenantId, "TRUSTED_CONTEXT_REQUIRED", "context.tenantId");
  const actorId = assertNonEmptyString(context.actorId, "TRUSTED_CONTEXT_REQUIRED", "context.actorId");
  const requestId = assertNonEmptyString(context.requestId, "TRUSTED_CONTEXT_REQUIRED", "context.requestId");
  if (!Array.isArray(context.permissions)) {
    throw new GovernedActionError("TRUSTED_CONTEXT_REQUIRED", "context.permissions must be an array");
  }
  const permissions = [];
  const seen = new Set();
  for (const rawPermission of context.permissions) {
    const permission = assertNonEmptyString(String(rawPermission), "TRUSTED_CONTEXT_REQUIRED", "context.permissions[]", 128);
    if (!PERMISSION_PATTERN.test(permission)) throw new GovernedActionError("TRUSTED_CONTEXT_REQUIRED", `Invalid context permission ${permission}`);
    if (!seen.has(permission)) {
      seen.add(permission);
      permissions.push(permission);
    }
  }
  const correlationId = context.correlationId === undefined
    ? requestId
    : assertNonEmptyString(context.correlationId, "TRUSTED_CONTEXT_REQUIRED", "context.correlationId", 512);
  return Object.freeze({
    tenantId,
    actorId,
    requestId,
    correlationId,
    permissions: Object.freeze(permissions),
  });
}

function hasPermission(context, required) {
  return context.permissions.includes("*") || context.permissions.includes(required);
}

function actionDigest({ context, manifest, input }) {
  return sha256Hex({ tenantId: context.tenantId, actionId: manifest.id, manifestVersion: manifest.version, input });
}

function safeEqualString(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function withTimeout(task, timeoutMs, externalSignal) {
  const controller = new AbortController();
  let timeout;
  let abortListener;
  const abortPromise = new Promise((_, reject) => {
    abortListener = () => {
      const reason = externalSignal?.reason instanceof GovernedActionError
        ? externalSignal.reason
        : new GovernedActionError("ACTION_CANCELLED", "Action was cancelled", { cause: externalSignal?.reason });
      controller.abort(reason);
      reject(reason);
    };
    if (externalSignal?.aborted) abortListener();
    else externalSignal?.addEventListener("abort", abortListener, { once: true });
  });
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const error = new GovernedActionError("ACTION_TIMEOUT", `Action exceeded ${timeoutMs}ms`, { retryable: true });
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => task(controller.signal)), timeoutPromise, abortPromise]);
  } finally {
    clearTimeout(timeout);
    if (abortListener) externalSignal?.removeEventListener("abort", abortListener);
  }
}

function transientFailure(error) {
  return error?.retryable === true || ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(error?.code);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new GovernedActionError("ACTION_CANCELLED", "Action was cancelled"));
      return;
    }
    let settled = false;
    let timer;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(signal.reason ?? new GovernedActionError("ACTION_CANCELLED", "Action was cancelled"));
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createGovernedActionExecutor(dependencies) {
  const { registry, authorizer, policyEvaluator, approvalStore, receiptStore, auditSink, clock = () => new Date() } = assertRecord(dependencies, "INVALID_DEPENDENCIES", "Dependencies are required");
  const supportedRegistry = registry instanceof Map
    || typeof registry?.get === "function"
    || typeof registry?.resolve === "function"
    || typeof registry?.getAction === "function";
  if (!supportedRegistry || typeof authorizer !== "function" || typeof policyEvaluator !== "function" || !receiptStore || typeof receiptStore.begin !== "function" || typeof auditSink?.append !== "function" || typeof clock !== "function") {
    throw new GovernedActionError("INVALID_DEPENDENCIES", "A supported registry, authorizer, policyEvaluator, receiptStore, auditSink and clock are required");
  }

  async function audit(event) {
    await auditSink.append(Object.freeze({ ...event, at: readClock(clock).toISOString(), details: redactForAudit(event.details ?? {}) }));
  }

  // One validation/authority/policy path for both native approval preflight and execution.
  // Preflight may persist a request, but never acquires an execution receipt or consumes consent.
  async function prepare(request, options) {
  const req = assertRecord(request, "INVALID_ACTION_REQUEST", "Action request is required");
  assertKnownKeys(req, ALLOWED_REQUEST_KEYS, "INVALID_ACTION_REQUEST", "Action request");
  const executionOptions = assertRecord(options, "INVALID_ACTION_OPTIONS", "Execution options must be an object");
  assertKnownKeys(executionOptions, ALLOWED_EXECUTION_OPTION_KEYS, "INVALID_ACTION_OPTIONS", "Execution options");
  const externalSignal = assertAbortSignal(executionOptions.signal);
  throwIfAborted(externalSignal);
  const actionId = assertNonEmptyString(req.actionId, "INVALID_ACTION_REQUEST", "actionId", 128);
  if (!ACTION_ID_PATTERN.test(actionId)) throw new GovernedActionError("INVALID_ACTION_REQUEST", "actionId has an invalid format");
  const context = normalizeContext(req.context);
  const requestInput = cloneJson(req.input);
  assertNoTenantOverride(requestInput);
  const manifest = normalizeManifest(await resolveRegistryEntry(registry, actionId), actionId);
  const validatedInput = cloneJson(validateWith(manifest.inputValidator, requestInput, "input"));
  assertNoTenantOverride(validatedInput);
  const input = deepFreezeJson(validatedInput);
  if (typeof manifest.businessValidator === "function") {
    try {
      const validated = await manifest.businessValidator(input, context);
      if (validated === false) throw new GovernedActionError("BUSINESS_VALIDATION_FAILED", "Action business validation denied the input");
    } catch (cause) {
      if (cause instanceof GovernedActionError) throw cause;
      throw new GovernedActionError("BUSINESS_VALIDATION_FAILED", "Action business validation failed", { cause });
    }
  }
  for (const permission of manifest.permissions) {
    if (!hasPermission(context, permission)) throw new GovernedActionError("ACTION_FORBIDDEN", `Missing action permission ${permission}`);
  }
  let authorized;
  try {
    authorized = await authorizer({ context, manifest, input });
  } catch (cause) {
    throw new GovernedActionError("AUTHORIZATION_CHECK_FAILED", "Object-level authorization could not be evaluated", { cause, retryable: true });
  }
  if (authorized !== true) throw new GovernedActionError("ACTION_FORBIDDEN", "Object-level authorization denied the action");

  let policy;
  try {
    policy = await policyEvaluator({ context, manifest, input });
  } catch (cause) {
    throw new GovernedActionError("POLICY_EVALUATION_FAILED", "Action policy could not be evaluated", { cause, retryable: true });
  }
  if (!policy || policy.allowed !== true) {
    const reason = typeof policy?.reason === "string" && policy.reason.trim() !== ""
      ? policy.reason.slice(0, 512)
      : "Action policy denied execution";
    throw new GovernedActionError("ACTION_POLICY_DENIED", reason);
  }
  if (policy.requiresApproval !== undefined && typeof policy.requiresApproval !== "boolean") {
    throw new GovernedActionError(
      "POLICY_EVALUATION_FAILED",
      "Action policy returned an invalid requiresApproval value",
    );
  }

  const digest = actionDigest({ context, manifest, input });
  const requiresApproval = policy.requiresApproval === true || manifest.risk === "HIGH" || manifest.risk === "CRITICAL";
  if (manifest.mutating && manifest.idempotency === "KEYED") assertNonEmptyString(req.idempotencyKey, "IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey", 256);
    throwIfAborted(externalSignal);
    return { req, externalSignal, actionId, context, manifest, input, digest, requiresApproval };
  }

  return Object.freeze({
    async preflight(request, options = {}) {
      const prepared = await prepare(request, options);
      const { req, context, manifest, input, digest, actionId, requiresApproval, externalSignal } = prepared;
      if (!requiresApproval) return Object.freeze({ requiresApproval: false, actionId, digest });
      if (typeof approvalStore?.request !== "function") {
        throw new GovernedActionError("APPROVAL_REQUIRED", "Durable approval requests are not configured");
      }
      throwIfAborted(externalSignal);
      const pending = await approvalStore.request({
        context, actionId, digest, manifestVersion: manifest.version,
        title: manifest.title ?? actionId, risk: manifest.risk, mutating: manifest.mutating,
        executionKey: req.idempotencyKey ?? context.requestId, input,
      });
      if (typeof pending?.id !== "string" || typeof pending?.status !== "string") {
        throw new GovernedActionError("INVALID_APPROVAL_STATE", "Approval request returned no durable identity");
      }
      return Object.freeze({ requiresApproval: true, actionId, digest, approvalId: pending.id, status: pending.status });
    },
    async execute(request, options = {}) {
      const { req, externalSignal, actionId, context, manifest, input, digest, requiresApproval } = await prepare(request, options);
      const receiptKey = manifest.idempotency === "NONE" ? null : `${context.tenantId}:${actionId}:${req.idempotencyKey ?? digest}`;
      let lease = null;
      if (receiptKey) {
        const minimumLeaseMs = manifest.timeoutMs * manifest.retry.attempts + manifest.retry.baseDelayMs * (2 ** (manifest.retry.attempts - 1) - 1) + 5000;
        const state = await receiptStore.begin({ key: receiptKey, digest, tenantId: context.tenantId, actionId, now: readClock(clock), replaySafe: !manifest.mutating || manifest.retrySafe, minimumLeaseMs });
        if (state.status === "SUCCEEDED") {
          if (!safeEqualString(state.digest, digest)) throw new GovernedActionError("IDEMPOTENCY_KEY_REUSED", "Idempotency key was reused with a different payload");
          return cloneJson(state.result);
        }
        if (state.status === "IN_PROGRESS") throw new GovernedActionError("ACTION_IN_PROGRESS", "The same action is already executing", { retryable: true });
        if (state.status !== "ACQUIRED") throw new GovernedActionError("INVALID_RECEIPT_STATE", "Receipt store returned an invalid state");
        lease = state.lease;
      }

      let receiptCompleted = false;
      let executionStarted = false;
      try {
        // Cancellation may race with validation/policy evaluation. Re-check before
        // consuming a one-time approval or invoking any action side effect.
        throwIfAborted(externalSignal);
        if (requiresApproval) {
          if (!approvalStore || typeof approvalStore.consume !== "function") throw new GovernedActionError("APPROVAL_REQUIRED", "Approval store is not configured");
          let selectedApprovalId = req.approvalId;
          if (!selectedApprovalId && typeof approvalStore.request === "function") {
            const pending = await approvalStore.request({ context, actionId, digest, manifestVersion: manifest.version, title: manifest.title ?? actionId, risk: manifest.risk, mutating: manifest.mutating, executionKey: req.idempotencyKey ?? context.requestId, input });
            if (pending.status !== "APPROVED") throw new GovernedActionError("APPROVAL_REQUIRED", "This exact action needs a current human approval. Do not create a new run or action key to bypass it.", { sideEffect: "NOT_STARTED", safeDetails: { approvalId: pending.id, status: pending.status } });
            selectedApprovalId = pending.id;
          }
          const approvalId = assertNonEmptyString(selectedApprovalId, "APPROVAL_REQUIRED", "approvalId");
          const approval = await approvalStore.consume({ approvalId, tenantId: context.tenantId, actionId, digest, actorId: context.actorId, executionKey: req.idempotencyKey ?? context.requestId, now: readClock(clock) });
          if (!approval || approval.consumed !== true || !safeEqualString(approval.digest, digest) || approval.tenantId !== context.tenantId || approval.actionId !== actionId) {
            throw new GovernedActionError("APPROVAL_INVALID", "Approval is invalid, expired, replayed or bound to another action");
          }
        }

        await audit({ type: "agent.action.started", tenantId: context.tenantId, actorId: context.actorId, actionId, requestId: context.requestId, correlationId: context.correlationId, details: { digest, risk: manifest.risk, input } });
        let attempt = 0;
        let rawResult;
        throwIfAborted(externalSignal);
        const maxAttempts = manifest.retrySafe && manifest.idempotency !== "NONE" ? manifest.retry.attempts : 1;
        while (attempt < maxAttempts) {
          attempt += 1;
          try {
            executionStarted = true;
            rawResult = await withTimeout((signal) => manifest.executor({
              input: cloneJson(input), context, signal, attempt,
              idempotencyKey: req.idempotencyKey ?? null, operationDigest: digest,
            }), manifest.timeoutMs, externalSignal);
            break;
          } catch (error) {
            if (attempt >= maxAttempts || !transientFailure(error)) throw error;
            await sleep(manifest.retry.baseDelayMs * (2 ** (attempt - 1)), externalSignal);
          }
        }
        const result = validateWith(manifest.outputValidator, cloneJson(rawResult), "output");
        if (lease) {
          await receiptStore.succeed({ lease, digest, result: cloneJson(result), now: readClock(clock) });
          receiptCompleted = true;
        }
        await audit({ type: "agent.action.succeeded", tenantId: context.tenantId, actorId: context.actorId, actionId, requestId: context.requestId, correlationId: context.correlationId, details: { digest, result, attempts: attempt } });
        return result;
      } catch (cause) {
        if (receiptCompleted) {
          try {
            await audit({ type: "agent.action.audit_write_failed_after_commit", tenantId: context.tenantId, actorId: context.actorId, actionId, requestId: context.requestId, correlationId: context.correlationId, details: { digest, errorCode: cause?.code ?? "AUDIT_WRITE_FAILED_AFTER_COMMIT" } });
          } catch {
            // The durable receipt remains the recovery source of truth when audit storage is unavailable.
          }
          throw new GovernedActionError("AUDIT_WRITE_FAILED_AFTER_COMMIT", "Action completed but its success audit event could not be persisted", { cause });
        }
        const ambiguous = Boolean(
          lease && !receiptCompleted && manifest.mutating && executionStarted &&
          cause?.sideEffect !== "NOT_STARTED" && !manifest.retrySafe
        );
        if (lease && !receiptCompleted) {
          if (ambiguous) {
            if (typeof receiptStore.ambiguous !== "function") {
              throw new GovernedActionError("AMBIGUOUS_RECEIPT_HANDLER_MISSING", "Mutating action outcome is ambiguous and the receipt store cannot quarantine it", { cause });
            }
            await receiptStore.ambiguous({ lease, digest, errorCode: cause?.code ?? "ACTION_OUTCOME_AMBIGUOUS", now: readClock(clock) });
          } else {
            await receiptStore.fail({ lease, digest, errorCode: cause?.code ?? "ACTION_EXECUTION_FAILED", now: readClock(clock) });
          }
        }
        try {
          await audit({ type: ambiguous ? "agent.action.ambiguous" : "agent.action.failed", tenantId: context.tenantId, actorId: context.actorId, actionId, requestId: context.requestId, correlationId: context.correlationId, details: { digest, errorCode: cause?.code ?? "ACTION_EXECUTION_FAILED", receiptCompleted } });
        } catch (auditCause) {
          if (receiptCompleted) throw new GovernedActionError("AUDIT_WRITE_FAILED_AFTER_COMMIT", "Action completed but its success audit event could not be persisted", { cause: auditCause });
          throw new GovernedActionError("AUDIT_WRITE_FAILED", "Action failed and its audit event could not be persisted", { cause: auditCause });
        }
        if (cause instanceof GovernedActionError) throw cause;
        throw new GovernedActionError("ACTION_EXECUTION_FAILED", "Action execution failed", { cause, retryable: manifest.retrySafe && transientFailure(cause) });
      }
    },
  });
}

export function createMemoryReceiptStore({ leaseMs = 30_000 } = {}) {
  if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 900_000) {
    throw new GovernedActionError("INVALID_RECEIPT_CONFIG", "leaseMs must be an integer from 1 to 900000");
  }
  const records = new Map();
  return {
    async begin({ key, digest, now, replaySafe = false, minimumLeaseMs = 0 }) {
      assertNonEmptyString(key, "INVALID_RECEIPT_INPUT", "key", 1_024);
      assertNonEmptyString(digest, "INVALID_RECEIPT_INPUT", "digest", 128);
      const current = records.get(key);
      const nowMs = assertValidDate(now, "INVALID_RECEIPT_INPUT", "now").getTime();
      if (current?.digest && !safeEqualString(current.digest, digest)) throw new GovernedActionError("IDEMPOTENCY_KEY_REUSED", "Idempotency key was reused with a different payload");
      if (current?.status === "SUCCEEDED") return { status: "SUCCEEDED", digest: current.digest, result: cloneJson(current.result) };
      if (current?.status === "AMBIGUOUS") throw new GovernedActionError("ACTION_REQUIRES_RECONCILIATION", "A previous execution has an ambiguous external outcome");
      if (current?.status === "IN_PROGRESS" && current.expiresAt > nowMs) {
        if (!safeEqualString(current.digest, digest)) throw new GovernedActionError("IDEMPOTENCY_KEY_REUSED", "Idempotency key was reused with a different payload");
        return { status: "IN_PROGRESS" };
      }
      if (current?.status === "IN_PROGRESS" && !replaySafe) {
        records.set(key, { status: "AMBIGUOUS", digest, errorCode: "LEASE_EXPIRED_UNKNOWN_OUTCOME" });
        throw new GovernedActionError("ACTION_REQUIRES_RECONCILIATION", "Expired action execution has an unknown external outcome");
      }
      if (typeof replaySafe !== "boolean" || !Number.isSafeInteger(minimumLeaseMs) || minimumLeaseMs < 0 || minimumLeaseMs > 900000) throw new GovernedActionError("INVALID_RECEIPT_INPUT", "Invalid receipt replay capability or minimum lease");
      const lease = `${key}:${nowMs}:${randomUUID()}`;
      records.set(key, { status: "IN_PROGRESS", digest, lease, expiresAt: nowMs + Math.max(leaseMs, minimumLeaseMs) });
      return { status: "ACQUIRED", lease };
    },
    async succeed({ lease, digest, result }) {
      const pair = [...records.entries()].find(([, value]) => value.lease === lease);
      if (!pair) throw new GovernedActionError("RECEIPT_LEASE_LOST", "Action receipt lease no longer exists");
      const [key, record] = pair;
      if (!safeEqualString(record.digest, digest)) throw new GovernedActionError("RECEIPT_DIGEST_MISMATCH", "Action receipt digest mismatch");
      records.set(key, { status: "SUCCEEDED", digest, result: cloneJson(result) });
    },
    async fail({ lease, digest, errorCode }) {
      const pair = [...records.entries()].find(([, value]) => value.lease === lease);
      if (!pair) throw new GovernedActionError("RECEIPT_LEASE_LOST", "Action receipt lease no longer exists");
      const [key, record] = pair;
      if (!safeEqualString(record.digest, digest)) throw new GovernedActionError("RECEIPT_DIGEST_MISMATCH", "Action receipt digest mismatch");
      records.set(key, { status: "FAILED", digest, errorCode });
    },
    async ambiguous({ lease, digest, errorCode }) {
      const pair = [...records.entries()].find(([, value]) => value.lease === lease);
      if (!pair) throw new GovernedActionError("RECEIPT_LEASE_LOST", "Action receipt lease no longer exists");
      const [key, record] = pair;
      if (!safeEqualString(record.digest, digest)) throw new GovernedActionError("RECEIPT_DIGEST_MISMATCH", "Action receipt digest mismatch");
      records.set(key, { status: "AMBIGUOUS", digest, errorCode });
    },
    snapshot() { return cloneJson([...records.entries()]); },
  };
}

export function createMemoryApprovalStore(approvals = []) {
  const records = new Map(approvals.map((item) => [item.id, { ...item, consumed: false }]));
  return {
    async consume({ approvalId, tenantId, actionId, digest, now }) {
      const item = records.get(approvalId);
      const nowMs = assertValidDate(now, "INVALID_APPROVAL_INPUT", "now").getTime();
      const expiresAtMs = item ? new Date(item.expiresAt).getTime() : Number.NaN;
      if (!item || !Number.isFinite(expiresAtMs) || item.consumed || item.tenantId !== tenantId || item.actionId !== actionId || !safeEqualString(item.digest, digest) || expiresAtMs <= nowMs) return null;
      item.consumed = true;
      return { consumed: true, tenantId, actionId, digest };
    },
  };
}

export { createPrismaReceiptStore, createPrismaApprovalStore, createPrismaAuditSink } from "./prisma-stores.mjs";

export { createPrismaApprovalLifecycle } from "./approval-lifecycle.mjs";

export { createActionPolicy } from "./policy-engine.mjs";
