import { analyticsAllowed } from "../../lib/analytics";

/** Explicit owner opt-in; a fork never inherits another project's telemetry key. */
export function landingAnalyticsPolicyAllows({
	enabled,
	key,
	hostname,
	doNotTrack,
}: {
	enabled?: string;
	key?: string;
	hostname: string;
	doNotTrack?: string | null;
}): boolean {
	return (
		enabled === "true" &&
		Boolean(key?.trim()) &&
		doNotTrack !== "1" &&
		doNotTrack !== "yes" &&
		analyticsAllowed(hostname)
	);
}
