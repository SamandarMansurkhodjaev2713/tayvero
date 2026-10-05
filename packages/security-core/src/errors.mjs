export class SecurityCoreError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "SecurityCoreError";
    Object.defineProperties(this, {
      code: { value: code, enumerable: true },
      retryable: { value: options.retryable === true, enumerable: true },
      safeDetails: {
        value: options.safeDetails ? Object.freeze({ ...options.safeDetails }) : undefined,
        enumerable: true,
      },
    });
  }

  toSafeJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.safeDetails ? { details: this.safeDetails } : {}),
    };
  }
}

export function securityError(code, message, options) {
  return new SecurityCoreError(code, message, options);
}
