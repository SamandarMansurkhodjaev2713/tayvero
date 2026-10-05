"use client";

import ArrowUpRight from "@carbon/icons-react/es/ArrowUpRight";
import GitHubLogo from "@crm/ui/components/brand-logos/github";
import { Button } from "@crm/ui/components/button";
import { type CtaLocation, captureLanding } from "./analytics";
import { REPO_URL } from "./links";

export function GitHubStarButton({ location }: { location: CtaLocation }) {
	return (
		<Button size="xl" wrap asChild>
			<a
				href={REPO_URL}
				target="_blank"
				rel="noopener noreferrer"
				onClick={() => captureLanding("github_star_clicked", location)}
			>
				<GitHubLogo aria-hidden="true" data-icon="inline-start" />
				Проект на GitHub
				<ArrowUpRight aria-hidden="true" data-icon="inline-end" />
			</a>
		</Button>
	);
}
