
export class IntegrationRuntimeError extends Error { constructor(code,message,details={}) { super(message); this.name="IntegrationRuntimeError"; this.code=code; this.details=Object.freeze({...details}); } }
export function fail(code,message,details) { throw new IntegrationRuntimeError(code,message,details); }
