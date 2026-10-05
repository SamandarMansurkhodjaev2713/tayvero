import { createActionRegistry } from "@crm/action-registry";
import { createPrismaBackedAgentActionExecution } from "./governed-action-prisma-composition.mjs";

const CRM_ACTIVITY_CREATE = "crm.activity.create";
const SLACK_MESSAGE_POST = "slack.message.post";
export const RUN_ACTION_MANIFEST_VERSION = "1.0.0";
const ACTION_IDS = Object.freeze([CRM_ACTIVITY_CREATE, SLACK_MESSAGE_POST]);
const REQUEST_KEYS = new Set(["runId", "callId", "input", "signal"]);
const CRM_ACTIVITY_INPUT_KEYS = new Set(["type", "targetKind", "targetId", "subject", "body", "dueAt"]);
const SLACK_MESSAGE_INPUT_KEYS = new Set(["text"]);
const CONTROL_FIELDS = new Set(["runId", "callId"]);
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_IDENTIFIER_LENGTH = 192;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const OPTION_KEYS = new Set([
  "prisma",
  "loadTrustedContext",
  "authorize",
  "evaluatePolicy",
  "executeCrmActivity",
  "executeSlackMessage",
  "clock",
  "receiptModel",
  "approvalModel",
  "auditModel",
  "receiptLeaseMs",
  "maxReceiptAcquireAttempts",
  "approvalLifecycleWorkspaceId",
]);

const nullableString = (maxLength) => ({
  anyOf: [
    { type: "string", maxLength },
    { type: "null" },
  ],
});

const crmActivityInputSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["runId", "callId", "type", "targetKind", "targetId"],
  properties: {
    runId: { type: "string", minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH, pattern: IDENTIFIER_PATTERN.source },
    callId: { type: "string", minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH, pattern: IDENTIFIER_PATTERN.source },
    type: { type: "string", enum: ["NOTE", "TASK"] },
    targetKind: { type: "string", enum: ["company", "contact", "deal"] },
    targetId: { type: "string", minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH },
    subject: nullableString(240),
    body: nullableString(10_000),
    dueAt: nullableString(128),
  },
});

const crmActivityOutputSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["actionId", "activityId", "replayed"],
  properties: {
    actionId: { type: "string", minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH },
    activityId: { type: "string", minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH },
    replayed: { type: "boolean" },
  },
});

const slackMessageInputSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["runId", "callId", "text"],
  properties: {
    runId: { type: "string", minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH, pattern: IDENTIFIER_PATTERN.source },
    callId: { type: "string", minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH, pattern: IDENTIFIER_PATTERN.source },
    text: { type: "string", minLength: 1, maxLength: 4_000 },
  },
});

const slackMessageOutputSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["actionId", "messageId", "destination", "replayed"],
  properties: {
    actionId: { type: "string", minLength: 1, maxLength: MAX_IDENTIFIER_LENGTH },
    messageId: { type: "string", minLength: 1, maxLength: 512 },
    destination: { type: "string", minLength: 1, maxLength: 240 },
    replayed: { type: "boolean" },
  },
});

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainRecord(value, field) {
  if (!isPlainRecord(value)) throw new TypeError(`${field} must be a plain object`);
  return value;
}

function snapshotPlainDataRecord(value, field) {
  const source = assertPlainRecord(value, field);
  const snapshot = Object.create(null);
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key !== "string") {
      throw new TypeError(`${field} must not contain symbol properties`);
    }
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw new TypeError(`${field} contains an unsafe property: ${key}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${field}.${key} must be an enumerable data property`);
    }
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

function assertKnownKeys(value, allowed, field) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`${field} contains unsupported fields: ${unknown.sort().join(", ")}`);
  }
}

function assertFunction(value, field) {
  if (typeof value !== "function") throw new TypeError(`${field} must be a function`);
  return value;
}

function assertIdentifier(value, field) {
  if (
    typeof value !== "string"
    || value.trim() === ""
    || value.length > MAX_IDENTIFIER_LENGTH
    || !IDENTIFIER_PATTERN.test(value)
  ) {
    throw new TypeError(
      `${field} must match ${IDENTIFIER_PATTERN.source} and be no longer than ${MAX_IDENTIFIER_LENGTH} characters`,
    );
  }
  return value;
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
    throw new TypeError("signal must implement the AbortSignal contract");
  }
  return value;
}

function requiredText(value, field, maxLength) {
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    throw new TypeError(`${field} must be a non-empty string no longer than ${maxLength} characters`);
  }
  return value;
}

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new TypeError(`${field} must be null or a string no longer than ${maxLength} characters`);
  }
  return value;
}

function normalizeCrmActivityInput(value) {
  const input = snapshotPlainDataRecord(value, "CRM activity input");
  assertKnownKeys(input, CRM_ACTIVITY_INPUT_KEYS, "CRM activity input");
  if (input.type !== "NOTE" && input.type !== "TASK") {
    throw new TypeError("CRM activity type must be NOTE or TASK");
  }
  if (!["company", "contact", "deal"].includes(input.targetKind)) {
    throw new TypeError("CRM activity targetKind is invalid");
  }
  const targetId = assertIdentifier(input.targetId, "CRM activity targetId");
  const subject = optionalText(input.subject, "CRM activity subject", 240);
  const body = optionalText(input.body, "CRM activity body", 10_000);
  const dueAt = optionalText(input.dueAt, "CRM activity dueAt", 128);
  if (input.type === "TASK" && !subject?.trim()) {
    throw new TypeError("A CRM task needs a subject");
  }
  if (input.type === "NOTE" && !subject?.trim() && !body?.trim()) {
    throw new TypeError("A CRM note needs a subject or body");
  }
  if (dueAt && Number.isNaN(new Date(dueAt).getTime())) {
    throw new TypeError("CRM activity dueAt is invalid");
  }
  return Object.freeze({
    type: input.type,
    targetKind: input.targetKind,
    targetId,
    subject: subject ?? null,
    body: body ?? null,
    dueAt: dueAt ?? null,
  });
}

function normalizeSlackMessageInput(value) {
  const input = snapshotPlainDataRecord(value, "Slack message input");
  assertKnownKeys(input, SLACK_MESSAGE_INPUT_KEYS, "Slack message input");
  return Object.freeze({ text: requiredText(input.text, "Slack message text", 4_000) });
}

function normalizeExecutionRequest(value) {
  const request = snapshotPlainDataRecord(value, "Run action request");
  assertKnownKeys(request, REQUEST_KEYS, "Run action request");
  return Object.freeze({
    runId: assertIdentifier(request.runId, "runId"),
    callId: assertIdentifier(request.callId, "callId"),
    input: request.input,
    signal: assertAbortSignal(request.signal),
  });
}

function assertPolicyDecision(value) {
  const decision = snapshotPlainDataRecord(value, "Run action policy decision");
  assertKnownKeys(decision, new Set(["allowed", "requiresApproval", "reason"]), "Run action policy decision");
  if (decision.allowed !== true && decision.allowed !== false) {
    throw new TypeError("Run action policy decision.allowed must be a boolean");
  }
  if (decision.requiresApproval !== undefined && typeof decision.requiresApproval !== "boolean") {
    throw new TypeError("Run action policy decision.requiresApproval must be a boolean when provided");
  }
  if (
    decision.reason !== undefined
    && (typeof decision.reason !== "string" || decision.reason.trim() === "" || decision.reason.length > 512)
  ) {
    throw new TypeError("Run action policy decision.reason must be a non-empty string no longer than 512 characters when provided");
  }
  return decision;
}

function actionIdempotencyKey(runId, callId) {
  const value = `${runId}:${callId}`;
  if (value.length > 256) throw new TypeError("The derived action idempotency key is too long");
  return value;
}

function stripControlFields(input) {
  const source = snapshotPlainDataRecord(input, "Governed action input");
  const businessInput = Object.create(null);
  for (const key of Object.keys(source)) {
    if (CONTROL_FIELDS.has(key)) continue;
    Object.defineProperty(businessInput, key, {
      configurable: false,
      enumerable: true,
      value: source[key],
      writable: false,
    });
  }
  return Object.freeze(businessInput);
}

function createCatalog(executors) {
  return createActionRegistry()
    .register(
      {
        id: CRM_ACTIVITY_CREATE,
        version: RUN_ACTION_MANIFEST_VERSION,
        title: "Create CRM activity",
        description: "Create one manifest-approved CRM note or task for an active agent run.",
        risk: "MEDIUM",
        mutating: true,
        idempotency: "KEYED",
        retrySafe: false,
        timeoutMs: 30_000,
        retry: { attempts: 1, baseDelayMs: 0 },
        permissions: [CRM_ACTIVITY_CREATE],
        inputSchema: crmActivityInputSchema,
        outputSchema: crmActivityOutputSchema,
        businessValidator(input) {
          normalizeCrmActivityInput(stripControlFields(input));
          return true;
        },
        metadata: { boundary: "agent-run", provider: "crm" },
      },
      executors.crm,
    )
    .register(
      {
        id: SLACK_MESSAGE_POST,
        version: RUN_ACTION_MANIFEST_VERSION,
        title: "Post Slack message",
        description: "Post one message to the exact Slack destination approved by the deployed agent version.",
        risk: "MEDIUM",
        mutating: true,
        idempotency: "KEYED",
        retrySafe: false,
        timeoutMs: 30_000,
        retry: { attempts: 1, baseDelayMs: 0 },
        permissions: [SLACK_MESSAGE_POST],
        inputSchema: slackMessageInputSchema,
        outputSchema: slackMessageOutputSchema,
        businessValidator(input) {
          normalizeSlackMessageInput(stripControlFields(input));
          return true;
        },
        metadata: { boundary: "agent-run", provider: "slack" },
      },
      executors.slack,
    );
}

export function createGovernedRunActionRuntime(options) {
  const source = snapshotPlainDataRecord(options, "options");
  assertKnownKeys(source, OPTION_KEYS, "options");
  const prisma = source.prisma;
  if (!prisma || typeof prisma !== "object") throw new TypeError("options.prisma is required");
  const loadTrustedContext = assertFunction(source.loadTrustedContext, "options.loadTrustedContext");
  const authorize = assertFunction(source.authorize, "options.authorize");
  const evaluatePolicy = assertFunction(source.evaluatePolicy, "options.evaluatePolicy");
  const executeCrmActivity = assertFunction(source.executeCrmActivity, "options.executeCrmActivity");
  const executeSlackMessage = assertFunction(source.executeSlackMessage, "options.executeSlackMessage");

  const registry = createCatalog({
    crm: async (execution) => {
      const businessInput = normalizeCrmActivityInput(stripControlFields(execution.input));
      return executeCrmActivity(Object.freeze({
        runId: execution.input.runId,
        callId: execution.input.callId,
        input: businessInput,
        signal: execution.signal,
        attempt: execution.attempt,
        idempotencyKey: execution.idempotencyKey,
        operationDigest: execution.operationDigest,
        context: execution.context,
      }));
    },
    slack: async (execution) => {
      const businessInput = normalizeSlackMessageInput(stripControlFields(execution.input));
      return executeSlackMessage(Object.freeze({
        runId: execution.input.runId,
        callId: execution.input.callId,
        input: businessInput,
        signal: execution.signal,
        attempt: execution.attempt,
        idempotencyKey: execution.idempotencyKey,
        operationDigest: execution.operationDigest,
        context: execution.context,
      }));
    },
  });

  const governed = createPrismaBackedAgentActionExecution({
    prisma,
    registry,
    authorizer: async ({ context, manifest, input }) => authorize(Object.freeze({
      actionId: manifest.id,
      runId: input.runId,
      callId: input.callId,
      input: Object.freeze(stripControlFields(input)),
      context,
      manifest,
    })),
    policyEvaluator: async ({ context, manifest, input }) => assertPolicyDecision(
      await evaluatePolicy(Object.freeze({
        actionId: manifest.id,
        runId: input.runId,
        callId: input.callId,
        input: Object.freeze(stripControlFields(input)),
        context,
        manifest,
      })),
    ),
    clock: source.clock,
    approvalLifecycleWorkspaceId: source.approvalLifecycleWorkspaceId,
    receiptModel: source.receiptModel,
    approvalModel: source.approvalModel,
    auditModel: source.auditModel,
    receiptLeaseMs: source.receiptLeaseMs,
    maxReceiptAcquireAttempts: source.maxReceiptAcquireAttempts,
  });

  async function execute(actionId, request, normalizeInput, preflight = false) {
    const normalized = normalizeExecutionRequest(request);
    const input = normalizeInput(normalized.input);
    const trustedContext = await loadTrustedContext(Object.freeze({
      actionId,
      runId: normalized.runId,
      callId: normalized.callId,
      input,
    }));
    return governed[preflight ? "prepareModelProposedAction" : "executeModelProposedAction"](
      {
        actionId,
        input: {
          runId: normalized.runId,
          callId: normalized.callId,
          ...input,
        },
      },
      trustedContext,
      {
        idempotencyKey: actionIdempotencyKey(normalized.runId, normalized.callId),
        signal: normalized.signal,
      },
    );
  }

  return Object.freeze({
    actionIds: ACTION_IDS,
    hasAction(actionId) {
      return typeof actionId === "string" && registry.has(actionId);
    },
    listActions() {
      return registry.list();
    },
    prepareCrmActivity(request) {
      return execute(CRM_ACTIVITY_CREATE, request, normalizeCrmActivityInput, true);
    },
    prepareSlackMessage(request) {
      return execute(SLACK_MESSAGE_POST, request, normalizeSlackMessageInput, true);
    },
    executeCrmActivity(request) {
      return execute(CRM_ACTIVITY_CREATE, request, normalizeCrmActivityInput);
    },
    executeSlackMessage(request) {
      return execute(SLACK_MESSAGE_POST, request, normalizeSlackMessageInput);
    },
  });
}

// The native framework emits raw tool input; normalize identically to the execution catalog.
export function normalizedRunActionInput(actionId, runId, callId, input) {
  const request = normalizeExecutionRequest({ runId, callId, input });
  const normalize = actionId === CRM_ACTIVITY_CREATE ? normalizeCrmActivityInput
    : actionId === SLACK_MESSAGE_POST ? normalizeSlackMessageInput : null;
  if (!normalize) throw new TypeError("Unsupported governed run action");
  return { runId: request.runId, callId: request.callId, ...normalize(request.input) };
}
