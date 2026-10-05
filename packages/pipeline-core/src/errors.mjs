
export class PipelineDomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PipelineDomainError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function fail(code, message, details) {
  throw new PipelineDomainError(code, message, details);
}
