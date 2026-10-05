import type { Metadata } from "next";
import { Suspense } from "react";
import { PageShell, PageShellFallback } from "@/components/page-shell";
import { requireSession } from "@/lib/session";
import { MigrationCenter } from "./migration-center";
export const metadata: Metadata = { title: "Migration Center" };

export default function MigrationPage() {
	return (
		<Suspense fallback={<PageShellFallback />}>
			<AuthorizedMigration />
		</Suspense>
	);
}

async function AuthorizedMigration() {
	await requireSession();
	return (
		<PageShell>
			<MigrationCenter />
		</PageShell>
	);
}
