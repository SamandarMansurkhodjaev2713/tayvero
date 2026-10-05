import { describe, expect, it } from "bun:test";
import { analyticsAllowed } from "../lib/analytics";

describe("analyticsAllowed", () => {
	it("allows the two hosts the landing page is served from", () => {
		expect(analyticsAllowed("product.example")).toBe(true);
		expect(analyticsAllowed("www.product.example")).toBe(true);
	});

	it("ignores case and surrounding whitespace", () => {
		expect(analyticsAllowed(" WWW.Product.Example ")).toBe(true);
	});

	it("refuses a self-hosted install serving the same page", () => {
		expect(analyticsAllowed("crm.acme.com")).toBe(false);
		expect(analyticsAllowed("localhost")).toBe(false);
	});

	it("refuses a preview deployment", () => {
		expect(analyticsAllowed("crm-git-preview-telemetry.vercel.app")).toBe(
			false,
		);
	});

	it("refuses a host that merely ends in the marketing domain", () => {
		expect(analyticsAllowed("evil-product.example")).toBe(false);
		expect(analyticsAllowed("product.example.attacker.com")).toBe(false);
	});
});
