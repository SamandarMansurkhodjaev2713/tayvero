import type { Metadata } from "next";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { requireMailboxAccess } from "@/lib/session";
import { ResearchForm } from "./research-form";

export const metadata: Metadata = {
	title: "Research key",
};

export const instant = false;

export default async function ResearchKeyPage() {
	await requireMailboxAccess();

	return (
		<AuthShell>
			<AuthHeading
				title="Connect company research"
				description="Optional: add your Context key for company enrichment. Contacts, deals and tasks work without it. You can connect it later in settings."
			/>

			<ResearchForm />
		</AuthShell>
	);
}
