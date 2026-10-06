import { describe, expect, it } from "bun:test";
import { BadRequestException } from "@nestjs/common";
import { updateWorkspaceInput } from "../src/workspace/workspace.contracts";
import { resolveWorkspaceWebsite } from "../src/workspace/workspace-website";

describe("optional workspace enrichment", () => {
	it("accepts name-only onboarding and distinguishes omission from clearing", () => {
		const omitted = updateWorkspaceInput.parse({ name: " Acme " });
		expect(omitted).toEqual({ name: "Acme" });
		expect(resolveWorkspaceWebsite(omitted.website, "acme.com")).toBe(
			"acme.com",
		);
		expect(resolveWorkspaceWebsite(omitted.website, null)).toBeNull();
		const blank = updateWorkspaceInput.parse({ name: "Acme", website: "  " });
		expect(blank.website).toBe("");
		expect(resolveWorkspaceWebsite(blank.website, "acme.com")).toBeNull();
	});

	it("normalizes a supplied domain without changing an omitted stored value", () => {
		expect(resolveWorkspaceWebsite(" HTTPS://WWW.Acme.com/about ", null)).toBe(
			"acme.com",
		);
		expect(resolveWorkspaceWebsite(undefined, "preserved.example")).toBe(
			"preserved.example",
		);
	});

	it("refuses nonempty invalid websites and malformed input types", () => {
		for (const value of ["not a website", "localhost", "https://", "acme"]) {
			expect(() => resolveWorkspaceWebsite(value, "acme.com")).toThrow(
				BadRequestException,
			);
		}
		for (const website of [null, 12, {}, "a".repeat(256)]) {
			expect(
				updateWorkspaceInput.safeParse({ name: "Acme", website }).success,
			).toBe(false);
		}
		expect(
			updateWorkspaceInput.safeParse({ name: " ", website: "" }).success,
		).toBe(false);
	});
});
