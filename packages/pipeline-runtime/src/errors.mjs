export class PipelineRuntimeError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = "PipelineRuntimeError";
		this.code = code;
		this.details = Object.freeze({ ...details });
	}
}
export function fail(code, message, details) {
	throw new PipelineRuntimeError(code, message, details);
}
