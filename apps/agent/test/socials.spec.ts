import { describe, expect, it } from "bun:test";
import { namesMatch } from "../agent/lib/names";
import { extractSocialUrls, parseSocialUrl } from "../agent/lib/socials";

describe("parseSocialUrl", () => {
	it("reads a profile on either X hostname", () => {
		expect(parseSocialUrl("https://x.com/alexmorgan")).toEqual({
			network: "x",
			handle: "alexmorgan",
			url: "https://x.com/alexmorgan",
		});
		expect(parseSocialUrl("https://twitter.com/AlexMorgan")?.url).toBe(
			"https://x.com/AlexMorgan",
		);
		expect(parseSocialUrl("https://mobile.twitter.com/@alex")?.handle).toBe(
			"alex",
		);
	});

	it("refuses a deep link, which is where most wrong handles come from", () => {
		expect(parseSocialUrl("https://x.com/someone/status/1234")).toBeNull();
		expect(parseSocialUrl("https://github.com/someone/some-repo")).toBeNull();
	});

	it("refuses site paths that parse like a username", () => {
		expect(parseSocialUrl("https://github.com/pricing")).toBeNull();
		expect(parseSocialUrl("https://github.com/orgs")).toBeNull();
		expect(parseSocialUrl("https://x.com/settings")).toBeNull();
		expect(parseSocialUrl("https://x.com/i")).toBeNull();
	});

	it("refuses handles neither network could issue", () => {
		expect(parseSocialUrl("https://x.com/waytoolongforanxhandle")).toBeNull();
		expect(parseSocialUrl("https://github.com/-alex")).toBeNull();
		expect(parseSocialUrl("https://github.com/alex--morgan")).toBeNull();
	});

	it("ignores anything that is not one of the two networks", () => {
		expect(parseSocialUrl("https://linkedin.com/in/alexmorgan")).toBeNull();
		expect(parseSocialUrl("not a url")).toBeNull();
		expect(parseSocialUrl("")).toBeNull();
	});
});

describe("extractSocialUrls", () => {
	it("pulls profiles out of prose and citations, deduplicated", () => {
		const found = extractSocialUrls([
			"You can find him at https://github.com/alexmorgan and https://x.com/alexmorgan.",
			"https://github.com/alexmorgan",
			"https://github.com/alexmorgan/crm",
		]);

		expect(found.map((f) => f.url)).toEqual([
			"https://github.com/alexmorgan",
			"https://x.com/alexmorgan",
		]);
	});

	it("finds nothing in an answer that cites nothing", () => {
		expect(extractSocialUrls(["I could not find a GitHub profile."])).toEqual(
			[],
		);
	});
});

describe("namesMatch", () => {
	it("accepts the same person written two ways", () => {
		expect(namesMatch("Alex Morgan", "Alex Morgan")).toBe(true);
		expect(namesMatch("Alex J. Morgan", "Alex Morgan")).toBe(true);
		expect(namesMatch("alex morgan", "Alex Morgan")).toBe(true);
	});

	it("rejects a near miss", () => {
		expect(namesMatch("Alex Monroe", "Alex Morgan")).toBe(false);
		expect(namesMatch("Alec Morgan", "Alex Morgan")).toBe(false);
	});

	it("rejects a first name on its own", () => {
		expect(namesMatch("Alex", "Alex Morgan")).toBe(false);
		expect(namesMatch(null, "Alex Morgan")).toBe(false);
	});
});
