export class RetryAbortedError extends Error { constructor(message = "Retry operation aborted") { super(message); this.name = "RetryAbortedError"; } }

function validateOptions(options) {
  const { maxAttempts = 3, baseDelayMs = 100, maxDelayMs = 5_000, backoffFactor = 2, jitterRatio = 0.2 } = options;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new RangeError("maxAttempts must be an integer between 1 and 20");
  if (![baseDelayMs, maxDelayMs].every((value) => Number.isFinite(value) && value >= 0)) throw new RangeError("delays must be finite non-negative numbers");
  if (!Number.isFinite(backoffFactor) || backoffFactor < 1 || backoffFactor > 10) throw new RangeError("backoffFactor must be between 1 and 10");
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) throw new RangeError("jitterRatio must be between 0 and 1");
  return { maxAttempts, baseDelayMs, maxDelayMs, backoffFactor, jitterRatio };
}
function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new RetryAbortedError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new RetryAbortedError()); }, { once: true });
  });
}

export async function retry(operation, options = {}) {
  if (typeof operation !== "function") throw new TypeError("operation must be a function");
  const config = validateOptions(options);
  const shouldRetry = options.shouldRetry ?? (() => false);
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  let lastError;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    if (options.signal?.aborted) throw new RetryAbortedError();
    try { return await operation({ attempt, signal: options.signal }); }
    catch (error) {
      lastError = error;
      const retryable = attempt < config.maxAttempts && await shouldRetry(error, attempt);
      options.onAttemptFailure?.({ error, attempt, retryable });
      if (!retryable) throw error;
      const exponential = Math.min(config.maxDelayMs, config.baseDelayMs * config.backoffFactor ** (attempt - 1));
      const jitter = exponential * config.jitterRatio * (random() * 2 - 1);
      const delay = Math.max(0, Math.min(config.maxDelayMs, Math.round(exponential + jitter)));
      await sleep(delay, options.signal);
    }
  }
  throw lastError;
}
