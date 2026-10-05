import { Button } from "@crm/ui/components/button";
import { CommandDialog } from "@crm/ui/components/command";
import { Input } from "@crm/ui/components/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@crm/ui/components/table";
import { TooltipProvider } from "@crm/ui/components/tooltip";
import { WorkspacePanel, WorkspaceStatus } from "@crm/ui/components/workspace";
import {
	APPEARANCE_STORAGE_KEY,
	applyAppearance,
	PALETTES,
} from "@crm/ui/theme/appearance";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseAsBoolean, useQueryState } from "nuqs";
import { NuqsAdapter } from "nuqs/adapters/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { OperationsCenter } from "@/app/(app)/[slug]/operations/operations-center";
import { SalesDashboard } from "@/app/(app)/[slug]/sales-dashboard";
import { MigrationCenter } from "@/app/(app)/[slug]/settings/migrations/migration-center";
import { TeamAgentsIndex } from "@/components/agent-builder/team-agents-index";
import { AppHeader } from "@/components/app-header";
import { AppIconRail } from "@/components/app-icon-rail";
import { TayveroLanding } from "@/components/landing/landing";
import { MobileNavProvider } from "@/components/mobile-nav";
import {
	PageShell,
	PageShellActions,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { SEARCH_PARAM } from "@/lib/search-param-keys";
import { agents, summary } from "./fixtures.mjs";

const q = new URLSearchParams(location.search);
const preset = {
	version: 1,
	palette: q.get("palette") || "graphite",
	density: q.get("density") || "comfortable",
	navigation: q.get("navigation") || "expanded",
};
applyAppearance(document.documentElement, preset);
localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preset));
const route = location.pathname.split("/").filter(Boolean).at(-1) || "demo";
const titles: Record<string, [string, string]> = {
	demo: [
		"Your business, in view",
		"The pipeline, the next step, and the work that needs your attention.",
	],
	agents: [
		"Your agent team",
		"One place to review what is running, what it costs, and what needs you.",
	],
	deals: ["Deals", "The pipeline, and everything that has already closed."],
	contacts: ["Contacts", "The people behind your business relationships."],
	companies: ["Companies", "Your customer context, connected."],
	settings: [
		"Workspace settings",
		"A workspace that fits the way your team works.",
	],
};
function Preview() {
	return (
		<NuqsAdapter>
			<PreviewContent />
		</NuqsAdapter>
	);
}

function PreviewContent() {
	const [client] = useState(
		() => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
	);
	const [searchOpen, setSearchOpen] = useQueryState(
		SEARCH_PARAM.dialog.switcher,
		parseAsBoolean.withDefault(false),
	);
	const [search, setSearch] = useState("");
	const [appearance, setAppearance] = useState(q.get("palette") || "graphite");
	const title = titles[route] || titles.demo;
	const list = [
		"Silk Road Logistics",
		"Atlas Retail",
		"Greenline Distribution",
		"Northstar Studio",
	].filter((x) => x.toLowerCase().includes(search.toLowerCase()));
	return (
		<QueryClientProvider client={client}>
			<ThemeProvider forcedTheme={q.get("mode") || "light"}>
				<TooltipProvider>
					<MobileNavProvider>
						<div className="preview-note">
							Component preview · Synthetic data · Business actions disabled
						</div>
						{route === "landing" ? (
							<TayveroLanding />
						) : (
							<div className="isolate flex min-h-0 flex-1 flex-col">
								<AppHeader
									user={{
										name: "Demo Operator",
										email: "operator@example.test",
										image: null,
									}}
								/>
								<div className="flex min-h-0 flex-1">
									<AppIconRail />
									<PageShell>
										{route === "operations" ? (
											<OperationsCenter />
										) : route === "migrations" ? (
											<MigrationCenter />
										) : (
											<>
												<PageShellHeader>
													<PageShellHeading>
														<PageShellTitle>{title[0]}</PageShellTitle>
														<PageShellDescription>
															{title[1]}
														</PageShellDescription>
													</PageShellHeading>
													<PageShellActions>
														<Button variant="outline" asChild>
															<a href="/demo/operations">Review operations</a>
														</Button>
													</PageShellActions>
												</PageShellHeader>
												<PageShellContent>
													{route === "agents" ? (
														<TeamAgentsIndex initialAgents={agents as never} />
													) : route === "settings" ? (
														<WorkspacePanel
															title="Appearance"
															description="Four palettes. A clear, consistent workspace in light and dark."
														>
															<div className="flex flex-wrap gap-3">
																{PALETTES.map((p) => (
																	<Button
																		key={p.id}
																		variant={
																			appearance === p.id
																				? "default"
																				: "outline"
																		}
																		onClick={() => {
																			setAppearance(p.id);
																			applyAppearance(
																				document.documentElement,
																				{
																					version: 1,
																					palette: p.id,
																					density: "comfortable",
																					navigation: "expanded",
																				},
																			);
																		}}
																	>
																		{p.name}
																	</Button>
																))}
															</div>
														</WorkspacePanel>
													) : (
														<>
															<SalesDashboard summary={summary as never} />
															<WorkspacePanel
																title={
																	route === "deals"
																		? "Your pipeline"
																		: "Next in your pipeline"
																}
																description="Sample records for visual inspection. Open a record to inspect the dialog pattern."
																action={
																	<Button variant="outline" asChild>
																		<a href="/demo/deals">View deals</a>
																	</Button>
																}
															>
																<div className="mb-4">
																	<label
																		htmlFor="fixture-search"
																		className="sr-only"
																	>
																		Search sample deals
																	</label>
																	<Input
																		id="fixture-search"
																		placeholder="Search sample deals…"
																		type="search"
																		value={search}
																		onChange={(e) => setSearch(e.target.value)}
																	/>
																</div>
																<Table>
																	<TableHeader>
																		<TableRow>
																			<TableHead>Deal</TableHead>
																			<TableHead>Stage</TableHead>
																			<TableHead>Value</TableHead>
																			<TableHead>Next step</TableHead>
																		</TableRow>
																	</TableHeader>
																	<TableBody>
																		{list.map((name, i) => (
																			<TableRow key={name}>
																				<TableCell>
																					<button
																						type="button"
																						className="font-medium text-left"
																						onClick={() => setSearchOpen(true)}
																					>
																						{name}
																					</button>
																					<p className="mt-1 text-xs text-muted-foreground">
																						Sample customer
																					</p>
																				</TableCell>
																				<TableCell>
																					<WorkspaceStatus
																						tone={
																							i === 1 ? "warning" : "neutral"
																						}
																					>
																						{i === 1 ? "Proposal" : "Qualified"}
																					</WorkspaceStatus>
																				</TableCell>
																				<TableCell className="tabular-nums">
																					$
																					{[48000, 36500, 24000, 18000][
																						i
																					].toLocaleString()}
																				</TableCell>
																				<TableCell>Review next step</TableCell>
																			</TableRow>
																		))}
																	</TableBody>
																</Table>
																{!list.length && (
																	<p
																		role="status"
																		className="p-6 text-sm text-muted-foreground"
																	>
																		No sample deals match. Try another search.
																	</p>
																)}
															</WorkspacePanel>
														</>
													)}
												</PageShellContent>
											</>
										)}
									</PageShell>
								</div>
							</div>
						)}
						<CommandDialog
							open={searchOpen}
							onOpenChange={setSearchOpen}
							title="Sample record"
							description="This preview uses synthetic data. No customer record or action will be created."
						>
							<Button onClick={() => setSearchOpen(false)}>
								Close preview
							</Button>
						</CommandDialog>
					</MobileNavProvider>
				</TooltipProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}
createRoot(document.getElementById("root")!).render(<Preview />);
