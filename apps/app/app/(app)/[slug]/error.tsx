"use client";
import { Button } from "@crm/ui/components/button";
import Link from "next/link";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

export default function WorkspaceError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const workspaceUrl = useWorkspaceUrl();
	return (
		<main className="flex min-w-0 flex-1 items-center justify-center p-6">
			<section
				role="alert"
				className="w-full max-w-lg rounded-xl border bg-card p-8"
			>
				<p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
					Workspace
				</p>
				<h1 className="text-2xl font-semibold tracking-tight">
					This page could not be loaded
				</h1>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
					Reload the page to try again. An operation you submitted may already
					have completed; check the record before submitting it again.
				</p>
				{error.digest ? (
					<p className="mt-3 font-mono text-xs text-muted-foreground">
						Reference: {error.digest}
					</p>
				) : null}
				<div className="mt-6 flex flex-wrap gap-3">
					<Button onClick={reset}>Reload page</Button>
					<Button asChild variant="outline">
						<Link href={workspaceUrl()}>Back to overview</Link>
					</Button>
				</div>
			</section>
		</main>
	);
}
