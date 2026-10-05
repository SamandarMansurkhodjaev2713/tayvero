"use client";

import Add from "@carbon/icons-react/es/Add";
import ArrowRight from "@carbon/icons-react/es/ArrowRight";
import Bot from "@carbon/icons-react/es/Bot";
import Renew from "@carbon/icons-react/es/Renew";
import Search from "@carbon/icons-react/es/Search";
import { Avatar, AvatarFallback } from "@crm/ui/components/avatar";
import { Button } from "@crm/ui/components/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@crm/ui/components/input-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@crm/ui/components/table";
import {
	WorkspaceMetric,
	WorkspaceMetrics,
	WorkspaceNotice,
	WorkspacePanel,
	WorkspaceStatus,
	WorkspaceToolbar,
} from "@crm/ui/components/workspace";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useId } from "react";
import { LocalRelativeTime } from "@/components/local-date-time";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";
import {
	displayRunCost,
	filterTeamAgents,
	summarizeTeamAgents,
} from "./team-agents-model.mjs";

type Agents = RouterOutputs["agents"]["list"];
const VIEWS = [
	"current",
	"all",
	"live",
	"paused",
	"review",
	"archived",
] as const;
const VIEW_LABELS = {
	current: "Current agents",
	all: "All agents",
	live: "Live",
	paused: "Paused",
	review: "Latest result needs review",
	archived: "Archived",
};
const RUN_LABELS: Record<string, string> = {
	QUEUED: "Queued",
	RUNNING: "Running",
	WAITING_FOR_APPROVAL: "Needs approval",
	SUCCEEDED: "Succeeded",
	FAILED: "Failed",
	CANCELLED: "Cancelled",
};

function resultTone(status: string) {
	if (status === "FAILED") return "danger";
	if (status === "WAITING_FOR_APPROVAL") return "warning";
	if (status === "SUCCEEDED") return "success";
	return "neutral";
}

export function TeamAgentsIndex({ initialAgents }: { initialAgents: Agents }) {
	const searchId = useId();
	const trpc = useTRPC();
	const workspaceUrl = useWorkspaceUrl();
	const agents = useQuery({
		...trpc.agents.list.queryOptions(),
		initialData: initialAgents,
	});
	const [filters, setFilters] = useQueryStates(
		{
			agentSearch: parseAsString.withDefault(""),
			agentView: parseAsStringLiteral(VIEWS).withDefault("current"),
		},
		{ history: "replace" },
	);
	const rows = agents.data ?? initialAgents;
	const summary = summarizeTeamAgents(rows);
	const visible = filterTeamAgents(rows, {
		query: filters.agentSearch,
		view: filters.agentView,
	});
	const hasFilters =
		filters.agentSearch.length > 0 || filters.agentView !== "current";

	return (
		<div className="flex min-w-0 flex-col gap-6">
			<WorkspaceMetrics label="Visible team-agent summary">
				<WorkspaceMetric
					label="Live agents"
					value={summary.live}
					detail="Deployed in this workspace"
				/>
				<WorkspaceMetric
					label="Paused"
					value={summary.paused}
					detail="Available to review"
				/>
				<WorkspaceMetric
					label="Latest results to review"
					value={summary.needsReview}
					tone={summary.needsReview ? "warning" : "default"}
					detail="Failed or awaiting approval"
				/>
				<WorkspaceMetric
					label="All visible agents"
					value={summary.visible}
					detail="Including archived agents"
				/>
			</WorkspaceMetrics>

			<WorkspaceToolbar>
				<label htmlFor={searchId} className="min-w-48 flex-1">
					<span className="sr-only">Search team agents</span>
					<InputGroup>
						<InputGroupAddon>
							<Search aria-hidden="true" />
						</InputGroupAddon>
						<InputGroupInput
							id={searchId}
							type="search"
							maxLength={200}
							placeholder="Search name or purpose…"
							value={filters.agentSearch}
							onChange={(event) =>
								void setFilters({ agentSearch: event.target.value })
							}
						/>
					</InputGroup>
				</label>
				<Select
					value={filters.agentView}
					onValueChange={(value) =>
						void setFilters({ agentView: value as (typeof VIEWS)[number] })
					}
				>
					<SelectTrigger aria-label="Filter agents" className="max-w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{VIEWS.map((view) => (
							<SelectItem key={view} value={view}>
								{VIEW_LABELS[view]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					variant="outline"
					disabled={agents.isFetching}
					onClick={() => void agents.refetch()}
				>
					<Renew aria-hidden="true" />
					{agents.isFetching ? "Refreshing…" : "Refresh"}
				</Button>
				<Button variant="outline" asChild>
					<Link href={workspaceUrl("/operations")}>
						Operations & approvals
						<ArrowRight aria-hidden="true" />
					</Link>
				</Button>
				<Button asChild>
					<Link href={workspaceUrl("/chat")}>
						<Add aria-hidden="true" />
						Create agent in chat
					</Link>
				</Button>
			</WorkspaceToolbar>

			{agents.isError ? (
				<WorkspaceNotice tone="danger" role="alert">
					The latest refresh failed. This is the previous snapshot; refresh
					before making an operational decision.
				</WorkspaceNotice>
			) : null}
			{summary.latestRunCoverage < rows.length ? (
				<WorkspaceNotice tone="warning" role="status">
					Some latest-run details are unavailable from this API version. Missing
					data is not counted as success.
				</WorkspaceNotice>
			) : null}

			<WorkspacePanel
				title="Team directory"
				description="Review each agent’s purpose, deployment status and latest recorded result."
				action={
					hasFilters ? (
						<Button
							variant="ghost"
							onClick={() =>
								void setFilters({ agentSearch: "", agentView: "current" })
							}
						>
							Reset filters
						</Button>
					) : undefined
				}
			>
				<p
					className="text-xs text-muted-foreground"
					role="status"
					aria-live="polite"
				>
					{visible.length} of {rows.length} visible agents ·{" "}
					{VIEW_LABELS[filters.agentView]}
				</p>
				{visible.length ? (
					// biome-ignore-start lint/a11y/noNoninteractiveTabindex: The horizontal table must be focusable for keyboard scrolling.
					<section
						aria-label="Team agents table, scroll horizontally to see all columns"
						tabIndex={0}
						className="min-w-0 overflow-x-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						aria-busy={agents.isFetching}
					>
						<Table containerClassName="overflow-visible">
							<caption className="sr-only">
								Visible team agents and their latest recorded run. Run counts
								are all-time totals.
							</caption>
							<TableHeader>
								<TableRow>
									<TableHead scope="col">Agent</TableHead>
									<TableHead scope="col">Status</TableHead>
									<TableHead scope="col">Latest result</TableHead>
									<TableHead scope="col">Last run</TableHead>
									<TableHead scope="col">Recorded cost</TableHead>
									<TableHead scope="col" className="text-right">
										All-time runs
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{visible.map((agent) => (
									<TableRow key={agent.id}>
										<TableCell className="min-w-64 whitespace-normal">
											<div className="flex items-start gap-3">
												<Avatar aria-hidden="true">
													<AvatarFallback>
														{Array.from(
															agent.name.trim(),
														)[0]?.toLocaleUpperCase("en-US") || <Bot />}
													</AvatarFallback>
												</Avatar>
												<div className="min-w-0">
													<Link
														href={workspaceUrl(`/agents/${agent.id}`)}
														className="break-words font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
													>
														{agent.name}
													</Link>
													<p className="mt-1 max-w-sm break-words text-xs leading-relaxed text-muted-foreground">
														{agent.description ??
															"Open this agent to review its purpose and access."}
													</p>
												</div>
											</div>
										</TableCell>
										<TableCell>
											<WorkspaceStatus
												tone={agent.status === "LIVE" ? "success" : "neutral"}
											>
												{agent.status.charAt(0) +
													agent.status.slice(1).toLowerCase()}
											</WorkspaceStatus>
										</TableCell>
										<TableCell>
											{agent.lastRun ? (
												<WorkspaceStatus
													tone={resultTone(agent.lastRun.status)}
												>
													{RUN_LABELS[agent.lastRun.status] ??
														agent.lastRun.status}
												</WorkspaceStatus>
											) : (
												<span className="text-muted-foreground">
													{agent.lastRun === null
														? "Not run yet"
														: "Unavailable"}
												</span>
											)}
										</TableCell>
										<TableCell>
											{agent.lastRun ? (
												<LocalRelativeTime date={agent.lastRun.createdAt} />
											) : (
												<span className="text-muted-foreground">—</span>
											)}
										</TableCell>
										<TableCell className="tabular-nums">
											{displayRunCost(agent.lastRun?.costUsd)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{agent.runCount}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</section>
					// biome-ignore-end lint/a11y/noNoninteractiveTabindex: End the single keyboard-scroll region exception.
				) : (
					<div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
						<Bot aria-hidden="true" className="size-6 text-muted-foreground" />
						<h3 className="text-base font-medium">
							{rows.length
								? "No agents match these filters"
								: "No team agents yet"}
						</h3>
						<p className="max-w-md text-sm leading-relaxed text-muted-foreground">
							{rows.length
								? "Your agents have not been removed. Adjust the search or include archived agents."
								: "Create an agent for one routine task, then review its allowed actions before deployment."}
						</p>
						{rows.length ? (
							<Button
								variant="outline"
								onClick={() =>
									void setFilters({ agentSearch: "", agentView: "all" })
								}
							>
								Clear filters
							</Button>
						) : (
							<Button asChild variant="outline">
								<Link href={workspaceUrl("/chat")}>
									<Add aria-hidden="true" />
									Start with a task
								</Link>
							</Button>
						)}
					</div>
				)}
			</WorkspacePanel>

			<p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
				Review counts describe each agent’s latest run, not every outstanding
				incident or approval. Cost is the amount recorded on that run; no time
				savings or ROI are inferred.
			</p>
		</div>
	);
}
