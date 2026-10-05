"use client";

import { useMountEffect } from "@crm/ui/hooks/use-mount-effect";
import { landingAnalyticsPolicyAllows } from "./analytics-policy";

export type CtaLocation = "hero" | "closing";

function allowed(): boolean {
	if (globalThis.window === undefined) return false;
	return landingAnalyticsPolicyAllows({
		enabled: process.env.NEXT_PUBLIC_LANDING_ANALYTICS_ENABLED,
		key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
		hostname: window.location.hostname,
		doNotTrack: navigator.doNotTrack,
	});
}

async function initializeLandingAnalytics() {
	if (!allowed()) return null;
	const { default: posthog } = await import("posthog-js");
	posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() ?? "", {
		api_host:
			process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
		defaults: "2026-06-25",
		autocapture: false,
		capture_pageview: false,
		capture_pageleave: false,
		disable_session_recording: true,
		person_profiles: "never",
	});
	return posthog;
}

let clientReady: ReturnType<typeof initializeLandingAnalytics> | null = null;

function landingClient() {
	if (!allowed()) return Promise.resolve(null);
	clientReady ??= initializeLandingAnalytics().catch(() => null);
	return clientReady;
}

export function LandingAnalytics() {
	useMountEffect(() => {
		void landingClient();
	});
	return null;
}

export function captureLanding(
	event: "setup_prompt_copied" | "github_star_clicked",
	location: CtaLocation,
): void {
	void landingClient()
		.then((client) => client?.capture(event, { cta_location: location }))
		.catch(() => {});
}
