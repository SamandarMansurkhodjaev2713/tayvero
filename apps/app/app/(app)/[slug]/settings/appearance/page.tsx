import type { Metadata } from "next";
import { PageShell, PageShellContent, PageShellDescription, PageShellHeader, PageShellHeading, PageShellTitle } from "@/components/page-shell";
import { AppearanceSettings } from "./appearance-settings";

export const metadata: Metadata = { title: "Appearance" };
// These preferences are per-device only. They never modify the workspace or its members.
export default function AppearancePage() {
  return <PageShell><PageShellHeader><PageShellHeading>
    <PageShellTitle>Appearance</PageShellTitle>
    <PageShellDescription>A workspace that feels right to you. Changes apply only to this browser.</PageShellDescription>
  </PageShellHeading></PageShellHeader><PageShellContent><AppearanceSettings /></PageShellContent></PageShell>;
}
