
export class MigrationDomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MigrationDomainError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function fail(code, message, details) {
  throw new MigrationDomainError(code, message, details);
}
