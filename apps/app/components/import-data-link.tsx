"use client";
import { Button } from "@crm/ui/components/button";
import Link from "next/link";
import { Suspense } from "react";
import { useOperationsLocale } from "@/lib/use-operations-locale";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

export function ImportDataLink() {
	return (
		<Suspense fallback={<ImportDataPlaceholder />}>
			<ResolvedImportDataLink />
		</Suspense>
	);
}

function ImportDataPlaceholder() {
	const { text } = useOperationsLocale();
	return (
		<Button variant="outline" disabled aria-busy="true">
			{text.migration}
		</Button>
	);
}

function ResolvedImportDataLink() {
	const url = useWorkspaceUrl();
	const { text } = useOperationsLocale();
	return (
		<Button asChild variant="outline">
			<Link href={url("/settings/migrations")}>{text.migration}</Link>
		</Button>
	);
}
