import { DEFAULT_WORKSPACE_NAME } from "@crm/auth";
import type { Metadata } from "next";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { requireMailboxAccess } from "@/lib/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = {
	title: "Set up",
};

export const instant = false;

export default async function OnboardingPage() {
	await requireMailboxAccess();

	return (
		<AuthShell>
			<AuthHeading
				title="Tell us about your company"
				description="Name your workspace so the team knows where to work. A company website is optional; research can be connected later."
			/>

			<OnboardingForm placeholder={DEFAULT_WORKSPACE_NAME} />
		</AuthShell>
	);
}
