"use client";

import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardDescription,
	CardHeader,
	CardPanel,
	CardPanelEmpty,
	CardTitle,
} from "@crm/ui/components/card";
import { CardTableEmpty } from "@crm/ui/components/card-table";
import { EmptyCellValue } from "@crm/ui/components/empty-cell";
import {
	EntityLogo,
	type EntityLogoTone,
} from "@crm/ui/components/entity-logo";
import {
	SimpleTable,
	type SimpleTableColumn,
	SimpleTableRow,
} from "@crm/ui/components/simple-table";
import { Skeleton } from "@crm/ui/components/skeleton";
import { TableCell } from "@crm/ui/components/table";
import { WorkspaceNotice } from "@crm/ui/components/workspace";
import { formatMoneyCompact } from "@crm/ui/lib/format";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useQueryState } from "nuqs";
import type { CSSProperties, ReactNode } from "react";
import { DealStageIndicator } from "@/components/crm/deal-stage";
import { RecordLink } from "@/components/crm/record-sheet/record-link";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { LocalRelativeTime } from "@/components/local-date-time";
import { activityLabel } from "@/lib/activity-presentation";
import { dealStageColor } from "@/lib/deal-stage";
import { SEARCH_PARAM } from "@/lib/search-param-keys";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";
import { type OverviewScope, overviewParsers } from "./overview-search-params";
import { PersonalFollowUps } from "./personal-follow-ups";
import { SalesDashboard } from "./sales-dashboard";

const CELL = "px-3 py-2.5 align-middle";
const OPEN_COLUMNS: SimpleTableColumn[] = [
	{ id: "deal", header: "Deal" },
	{
		id: "stage",
		header: "Stage",
		width: "w-32",
		className: "hidden lg:table-cell",
	},
	{
		id: "share",
		srLabel: "Share of the largest",
		width: "w-24",
		className: "hidden sm:table-cell",
	},
	{ id: "value", header: "Value", width: "w-20", align: "right" },
];
const ACTIVITY_COLUMNS: SimpleTableColumn[] = [
	{ id: "activity", header: "Activity" },
	{
		id: "company",
		header: "Company",
		width: "w-44",
		className: "hidden md:table-cell",
	},
	{
		id: "deal",
		header: "Deal",
		width: "w-48",
		className: "hidden lg:table-cell",
	},
	{
		id: "who",
		header: "Who",
		width: "w-32",
		className: "hidden md:table-cell",
	},
	{ id: "when", header: "When", width: "w-20", align: "right" },
];

export function DashboardSummary() {
	const [scope, setScope] = useQueryState(
		SEARCH_PARAM.overview.scope,
		overviewParsers[SEARCH_PARAM.overview.scope],
	);
	return (
		<div className="flex flex-col gap-6">
			<PersonalFollowUps
				key={scope}
				scope={scope === "me" ? "me" : "team"}
				onScopeChange={(next) =>
					void setScope(next === "me" ? "me" : "everyone")
				}
			/>
			<DashboardSnapshot scope={scope} />
		</div>
	);
}

function DashboardSnapshot({ scope }: { scope: OverviewScope }) {
	const trpc = useTRPC();
	const openRecord = useOpenRecord();
	const workspaceUrl = useWorkspaceUrl();

	const summaryQuery = useQuery({
		...trpc.dashboard.summary.queryOptions({ scope }),
		placeholderData: (previous) => previous,
	});

	const summary = summaryQuery.data;

	if (!summary) {
		if (summaryQuery.isError)
			return (
				<WorkspaceNotice role="alert" tone="danger">
					<p className="font-medium">Your overview could not be loaded</p>
					<p className="mt-1">
						No changes have been made. Try loading the latest workspace snapshot
						again.
					</p>
					<Button
						variant="outline"
						className="mt-3"
						disabled={summaryQuery.isFetching}
						onClick={() => void summaryQuery.refetch()}
					>
						Try again
					</Button>
				</WorkspaceNotice>
			);
		return (
			<div
				role="status"
				aria-label="Loading workspace overview"
				className="flex flex-col gap-6"
			>
				<Skeleton className="h-32 w-full rounded-lg" />
				<div className="grid gap-4 md:grid-cols-[2fr_1fr]">
					<Skeleton className="h-72 w-full rounded-lg" />
					<Skeleton className="h-72 w-full rounded-lg" />
				</div>
				<span className="sr-only">Loading your latest sales overview…</span>
			</div>
		);
	}

	const { biggestOpen, recentActivity } = summary;

	const mine = scope === "me";
	const largestOpenCents = biggestOpen[0]?.baseAmountCents ?? 0;

	return (
		<div className="flex flex-col gap-6">
			{summaryQuery.isError && (
				<WorkspaceNotice role="status" tone="warning">
					The latest refresh failed. You are viewing the previous snapshot.{" "}
					<Button variant="link" onClick={() => void summaryQuery.refetch()}>
						Refresh overview
					</Button>
				</WorkspaceNotice>
			)}
			<SalesDashboard summary={summary} />

			<div className="grid gap-6">
				<Card className="min-w-0">
					<CardHeader>
						<CardTitle>Deals in progress</CardTitle>
						<CardDescription>
							The largest open deals, and how long each has sat in its stage
						</CardDescription>
						<CardAction>
							<Button asChild variant="contrast" size="sm">
								<Link href={workspaceUrl("/deals")}>Open deals</Link>
							</Button>
						</CardAction>
					</CardHeader>
					<CardPanel>
						{biggestOpen.length === 0 ? (
							<CardPanelEmpty>
								Nothing open. Time to fill the pipeline.
							</CardPanelEmpty>
						) : (
							<SimpleTable
								variant="panel"
								surface="page"
								columns={OPEN_COLUMNS}
							>
								{biggestOpen.map((deal) => (
									<SimpleTableRow
										key={deal.id}
										clickable
										onClick={() => openRecord({ kind: "deal", id: deal.id })}
									>
										<TableCell className={CELL}>
											<DealCell
												name={deal.name}
												company={deal.company}
												meta={<LocalRelativeTime date={deal.stageChangedAt} />}
											/>
										</TableCell>
										<TableCell className={`${CELL} hidden lg:table-cell`}>
											<DealStageIndicator stage={deal.stage} />
										</TableCell>
										<TableCell className={`${CELL} hidden sm:table-cell`}>
											<ValueMeter
												share={
													largestOpenCents > 0
														? ((deal.baseAmountCents ?? 0) / largestOpenCents) *
															100
														: 0
												}
												color={dealStageColor(deal.stage)}
											/>
										</TableCell>
										<TableCell className={`${CELL} text-right tabular-nums`}>
											{deal.amountCents === null ? (
												<EmptyCellValue />
											) : (
												formatMoneyCompact(deal.amountCents, deal.currency)
											)}
										</TableCell>
									</SimpleTableRow>
								))}
							</SimpleTable>
						)}
					</CardPanel>
				</Card>
			</div>

			<Card className="min-w-0">
				<CardHeader>
					<CardTitle>
						{mine ? "Your recent activity" : "Recent activity"}
					</CardTitle>
					<CardDescription>
						{mine
							? "Every note, task and stage change you have logged"
							: "Every note, task and stage change across the workspace"}
					</CardDescription>
					<CardAction>
						<Button asChild variant="contrast" size="sm">
							<Link href={workspaceUrl("/companies")}>All companies</Link>
						</Button>
					</CardAction>
				</CardHeader>
				{recentActivity.length === 0 ? (
					<CardTableEmpty>Nothing has happened yet.</CardTableEmpty>
				) : (
					<SimpleTable columns={ACTIVITY_COLUMNS}>
						{recentActivity.map((entry) => (
							<SimpleTableRow key={entry.id}>
								<TableCell className={CELL}>
									<span className="truncate">
										{entry.subject ?? activityLabel(entry.type)}
									</span>
								</TableCell>
								<TableCell className={`${CELL} hidden md:table-cell`}>
									{entry.company ? (
										<RecordLink kind="company" id={entry.company.id}>
											{entry.company.name}
										</RecordLink>
									) : (
										<EmptyCellValue />
									)}
								</TableCell>
								<TableCell className={`${CELL} hidden lg:table-cell`}>
									{entry.deal ? (
										<RecordLink kind="deal" id={entry.deal.id}>
											{entry.deal.name}
										</RecordLink>
									) : (
										<EmptyCellValue />
									)}
								</TableCell>
								<TableCell
									className={`${CELL} hidden truncate text-muted-foreground md:table-cell`}
								>
									{entry.createdBy.name}
								</TableCell>
								<TableCell
									className={`${CELL} text-right text-muted-foreground`}
								>
									<LocalRelativeTime date={entry.createdAt} />
								</TableCell>
							</SimpleTableRow>
						))}
					</SimpleTable>
				)}
			</Card>
		</div>
	);
}

function DealCell({
	name,
	company,
	meta,
}: {
	name: string;
	company: {
		name: string;
		iconUrl: string | null;
		iconDarkUrl: string | null;
		iconTone: string | null;
	};
	meta?: ReactNode;
}) {
	return (
		<span className="flex min-w-0 items-center gap-2">
			<EntityLogo
				src={company.iconUrl}
				darkSrc={company.iconDarkUrl}
				tone={company.iconTone as EntityLogoTone | null | undefined}
				name={company.name}
				size="sm"
			/>
			<span className="flex min-w-0 flex-col">
				<span className="truncate font-medium">{name}</span>
				<span className="truncate text-muted-foreground">
					{meta ? (
						<>
							{company.name} · {meta}
						</>
					) : (
						company.name
					)}
				</span>
			</span>
		</span>
	);
}

function ValueMeter({ share, color }: { share: number; color: string }) {
	return (
		<span
			className="bloom-low flex h-1.5 w-full overflow-hidden bg-muted"
			style={{ "--bloom-color": color } as CSSProperties}
		>
			<span
				className="h-full w-(--share)"
				style={
					{
						backgroundColor: color,
						"--share": `${Math.round(Math.max(Math.min(share, 100), 0))}%`,
					} as CSSProperties
				}
			/>
		</span>
	);
}
