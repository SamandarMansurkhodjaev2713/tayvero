
export class MigrationRuntimeError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = "MigrationRuntimeError"; this.code = code; this.details = Object.freeze({ ...details }); }
}
export function fail(code, message, details) { throw new MigrationRuntimeError(code, message, details); }
