export function runBackgroundLoop<T>(options: {
	runOnce: (options: { signal: AbortSignal }) => Promise<T>;
	signal: AbortSignal;
	once?: boolean;
	pollMs?: number;
	onTick?: (result: T) => void | Promise<void>;
	onError?: (error: {
		code: string;
		consecutiveFailures: number;
	}) => void | Promise<void>;
}): Promise<{
	ticks: number;
	stopped: boolean;
}>;
