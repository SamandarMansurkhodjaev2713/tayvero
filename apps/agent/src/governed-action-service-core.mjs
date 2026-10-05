const ACTION_ID_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/;
const ALLOWED_PROPOSAL_KEYS = new Set(["actionId", "input"]);
const ALLOWED_OPTION_KEYS = new Set(["approvalId", "idempotencyKey", "signal"]);

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainRecord(value, field) {
  if (!isPlainRecord(value)) throw new TypeError(`${field} must be a plain object`);
  return value;
}

function assertSupportedRegistry(registry) {
  const supported = registry instanceof Map
    || typeof registry?.get === "function"
    || typeof registry?.resolve === "function"
    || typeof registry?.getAction === "function";
  if (!supported) {
    throw new TypeError("dependencies.registry must explicitly provide get, resolve or getAction");
  }
  if (typeof registry?.execute === "function") {
    throw new TypeError("dependencies.registry must be a catalog only; direct registry execution is forbidden");
  }
  return registry;
}

function normalizeProposal(proposal) {
  const source = assertPlainRecord(proposal, "Model proposal");
  const unknown = Object.keys(source).filter((key) => !ALLOWED_PROPOSAL_KEYS.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`Model proposal contains unsupported control fields: ${unknown.sort().join(", ")}`);
  }
  if (typeof source.actionId !== "string" || !ACTION_ID_PATTERN.test(source.actionId)) {
    throw new TypeError("Model proposal actionId is invalid");
  }
  if (!Object.hasOwn(source, "input")) throw new TypeError("Model proposal input is required");
  return Object.freeze({ actionId: source.actionId, input: source.input });
}

function normalizeOptions(options) {
  if (options === undefined) return Object.freeze({});
  const source = assertPlainRecord(options, "Execution options");
  const unknown = Object.keys(source).filter((key) => !ALLOWED_OPTION_KEYS.has(key));
  if (unknown.length > 0) throw new TypeError(`Execution options contain unsupported fields: ${unknown.sort().join(", ")}`);
  for (const field of ["approvalId", "idempotencyKey"]) {
    if (source[field] !== undefined && (typeof source[field] !== "string" || source[field].trim() === "" || source[field].length > 256)) {
      throw new TypeError(`${field} must be a non-empty string no longer than 256 characters`);
    }
  }
  if (source.signal !== undefined) {
    const signal = source.signal;
    if (typeof signal?.aborted !== "boolean" || typeof signal?.addEventListener !== "function" || typeof signal?.removeEventListener !== "function") {
      throw new TypeError("signal must implement the AbortSignal contract");
    }
  }
  return Object.freeze({
    approvalId: source.approvalId,
    idempotencyKey: source.idempotencyKey,
    signal: source.signal,
  });
}

export function createAgentActionExecutionServiceCore(dependencies, createExecutor) {
  const source = assertPlainRecord(dependencies, "dependencies");
  if (typeof createExecutor !== "function") throw new TypeError("createExecutor must be a function");
  const registry = assertSupportedRegistry(source.registry);
  const governed = createExecutor({ ...source, registry });
  if (!governed || typeof governed.execute !== "function") {
    throw new TypeError("createExecutor must return a governed executor with execute(request, options)");
  }

  return Object.freeze({
    async prepareModelProposedAction(proposal, trustedContext, options) {
      const normalizedProposal = normalizeProposal(proposal);
      const normalizedOptions = normalizeOptions(options);
      if (typeof governed.preflight !== "function") throw new TypeError("Governed preflight is unavailable");
      return governed.preflight({
        actionId: normalizedProposal.actionId, input: normalizedProposal.input,
        idempotencyKey: normalizedOptions.idempotencyKey, context: trustedContext,
      }, { signal: normalizedOptions.signal });
    },
    async executeModelProposedAction(proposal, trustedContext, options) {
      const normalizedProposal = normalizeProposal(proposal);
      const normalizedOptions = normalizeOptions(options);
      return governed.execute(
        {
          actionId: normalizedProposal.actionId,
          input: normalizedProposal.input,
          idempotencyKey: normalizedOptions.idempotencyKey,
          approvalId: normalizedOptions.approvalId,
          context: trustedContext,
        },
        { signal: normalizedOptions.signal },
      );
    },
  });
}
