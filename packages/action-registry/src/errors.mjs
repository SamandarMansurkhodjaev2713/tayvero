export class ActionRegistryError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "ActionRegistryError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function fail(code, message, details, options) {
  throw new ActionRegistryError(code, message, details, options);
}
