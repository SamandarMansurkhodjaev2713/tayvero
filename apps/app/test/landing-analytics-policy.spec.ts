import { describe, expect, it } from "bun:test";
import { landingAnalyticsPolicyAllows } from "../components/landing/analytics-policy";

const configured = {
	enabled: "true",
	key: "test-owner-write-only-key",
	hostname: "product.example",
};

describe("owner-controlled landing analytics policy", () => {
	it("keeps an unconfigured fork disabled even on an allowed host", () => {
		expect(landingAnalyticsPolicyAllows({ hostname: "product.example" })).toBe(
			false,
		);
		expect(
			landingAnalyticsPolicyAllows({ ...configured, enabled: undefined }),
		).toBe(false);
		expect(
			landingAnalyticsPolicyAllows({ ...configured, enabled: "false" }),
		).toBe(false);
	});
	it("requires an explicit nonempty owner key", () => {
		expect(
			landingAnalyticsPolicyAllows({ ...configured, key: undefined }),
		).toBe(false);
		expect(landingAnalyticsPolicyAllows({ ...configured, key: "   " })).toBe(
			false,
		);
	});
	it("honors browser Do Not Track despite deployment opt-in", () => {
		expect(
			landingAnalyticsPolicyAllows({ ...configured, doNotTrack: "1" }),
		).toBe(false);
		expect(
			landingAnalyticsPolicyAllows({ ...configured, doNotTrack: "yes" }),
		).toBe(false);
	});
	it("does not broaden the marketing-host boundary", () => {
		expect(
			landingAnalyticsPolicyAllows({ ...configured, hostname: "localhost" }),
		).toBe(false);
		expect(
			landingAnalyticsPolicyAllows({ ...configured, hostname: "crm.acme.com" }),
		).toBe(false);
		expect(
			landingAnalyticsPolicyAllows({
				...configured,
				hostname: "product.example.attacker.com",
			}),
		).toBe(false);
	});
	it("permits only the configured owner opt-in with a permitted host", () => {
		expect(landingAnalyticsPolicyAllows(configured)).toBe(true);
		expect(
			landingAnalyticsPolicyAllows({
				...configured,
				doNotTrack: "0",
				hostname: " WWW.Product.Example ",
			}),
		).toBe(true);
	});
});
