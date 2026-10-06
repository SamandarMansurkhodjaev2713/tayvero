import { BadRequestException } from "@nestjs/common";
import { normalizeDomain } from "../companies/domain";

/** Omission preserves settings; an explicit blank removes optional enrichment. */
export function resolveWorkspaceWebsite(
	input: string | undefined,
	before: string | null | undefined,
): string | null {
	if (input === undefined) return before ?? null;
	if (!input.trim()) return null;
	const website = normalizeDomain(input);
	if (!website) {
		throw new BadRequestException(
			"That is not a website. Enter the domain, like acme.com, or leave it blank.",
		);
	}
	return website;
}
