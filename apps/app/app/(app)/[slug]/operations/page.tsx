import type { Metadata } from "next";
import { Suspense } from "react";
import { PageShell, PageShellFallback } from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { OperationsCenter } from "./operations-center";
export const metadata: Metadata = { title: "Agent Operations" };

export default function OperationsPage() {
	return (
		<Suspense fallback={<PageShellFallback />}>
			<AuthorizedOperations />
		</Suspense>
	);
}

async function AuthorizedOperations() {
	await requireSession();
	return (
		<PageShell>
			<OperationsCenter />
		</PageShell>
	);
}
