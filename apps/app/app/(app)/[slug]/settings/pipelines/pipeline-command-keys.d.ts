export interface PipelineCommandKeyStore {
	get(scope: string, fingerprint: string): string;
	clear(scope: string, expectedKey?: string): boolean;
	size(): number;
}

export function createPipelineCommandKeyStore(options?: {
	capacity?: number;
	keyFactory?: (scope: string) => string;
}): PipelineCommandKeyStore;
