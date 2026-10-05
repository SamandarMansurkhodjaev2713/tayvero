import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellLoading,
	PageShellTitle,
} from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { PipelineSettings } from "./pipeline-settings";

export const metadata: Metadata = { title: "Pipelines" };

export default function PipelinesSettingsPage() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Pipelines</PageShellTitle>
					<PageShellDescription>
						Model each sales process with its own stages, probabilities and
						allowed transitions.
					</PageShellDescription>
				</PageShellHeading>
			</PageShellHeader>
			<PageShellContent>
				<Suspense fallback={<PageShellLoading />}>
					<Pipelines />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Pipelines() {
	await requireSession();
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();
	await queryClient.prefetchQuery(
		trpc.pipelines.list.queryOptions({ includeArchived: true }),
	);
	return (
		<HydrateClient>
			<PipelineSettings />
		</HydrateClient>
	);
}
