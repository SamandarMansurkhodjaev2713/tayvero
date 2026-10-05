"use client";
import ArrowUpRight from "@carbon/icons-react/es/ArrowUpRight";
import RefreshCw from "@carbon/icons-react/es/Renew";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@crm/ui/components/alert-dialog";
import { Button } from "@crm/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader } from "@crm/ui/components/empty";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { Skeleton } from "@crm/ui/components/skeleton";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@crm/ui/components/tabs";
import { Textarea } from "@crm/ui/components/textarea";
import {
	WorkspaceMetric,
	WorkspaceMetrics,
	WorkspaceNotice,
	WorkspacePanel,
	WorkspaceToolbar,
} from "@crm/ui/components/workspace";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import {
	PageShellActions,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import {
	OperationsLanguage,
	useOperationsLocale,
} from "@/lib/use-operations-locale";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";
import {
	approvalDecisionPayload,
	mayDecideApproval,
} from "./approval-view-model.mjs";
import { ContinuationsPanel } from "./continuations-panel";
import {
	approvalRisk,
	OperationStatus,
	operationState,
} from "./operation-status";

const FILTERS = [
	"PENDING",
	"APPROVED",
	"REJECTED",
	"EXPIRED",
	"CANCELLED",
	"CONSUMED",
	"ALL",
] as const;
type Approval = RouterOutputs["operations"]["approvals"]["items"][number];
type Decision = "APPROVED" | "REJECTED" | "CANCELLED";
export function OperationsCenter() {
	const trpc = useTRPC(),
		qc = useQueryClient(),
		url = useWorkspaceUrl();
	const { locale, text: t } = useOperationsLocale();
	const [hours, setHours] = useState<24 | 168>(24),
		[tab, setTab] = useState("overview"),
		[filter, setFilter] = useState<(typeof FILTERS)[number]>("PENDING");
	const [before, setBefore] = useState<{
			id: string;
			createdAt: string;
		} | null>(null),
		[selected, setSelected] = useState<{
			row: Approval;
			decision: Decision;
		} | null>(null),
		[note, setNote] = useState("");
	const [decisionError, setDecisionError] = useState(false),
		[saved, setSaved] = useState(false);
	const capabilities = useQuery(trpc.operations.capabilities.queryOptions({}));
	const overview = useQuery({
		...trpc.operations.overview.queryOptions({ hours }),
		enabled: !!capabilities.data,
		refetchInterval: 30000,
	});
	const approvals = useQuery({
		...trpc.operations.approvals.queryOptions({ status: filter, before }),
		enabled:
			capabilities.data?.approvalsEnabled === true && tab === "approvals",
		refetchInterval: 15000,
	});
	const decide = useMutation(trpc.operations.decideApproval.mutationOptions());
	const stamp = (value: string | null) =>
		value ? (
			<time dateTime={value} title={value}>
				{new Intl.DateTimeFormat(locale, {
					dateStyle: "medium",
					timeStyle: "short",
				}).format(new Date(value))}
			</time>
		) : (
			t.unknown
		);
	const state = (value: string) => operationState(value, t);
	const showError =
		decisionError ||
		capabilities.isError ||
		overview.isError ||
		(tab === "approvals" && approvals.isError);
	const forbidden = capabilities.error?.data?.code === "FORBIDDEN";
	const refresh = async () => {
		setDecisionError(false);
		await qc.invalidateQueries({ queryKey: trpc.operations.pathKey() });
	};
	const choose = (row: Approval, decision: Decision) => {
		if (!mayDecideApproval(row, decision)) return;
		setSelected({ row, decision });
		setNote("");
		setSaved(false);
		setDecisionError(false);
	};
	const confirm = async () => {
		if (!selected) return;
		const item = selected;
		setSelected(null);
		try {
			const current = approvals.data?.items.find((x) => x.id === item.row.id);
			if (!current || current.version !== item.row.version)
				throw new Error("stale");
			await decide.mutateAsync(
				approvalDecisionPayload(item.row, item.decision, note),
			);
			setSaved(true);
			await refresh();
		} catch {
			setDecisionError(true);
			await qc.invalidateQueries({ queryKey: trpc.operations.pathKey() });
		}
	};
	const data = overview.data,
		m = data?.metrics;
	return (
		<div className="min-w-0 space-y-6" lang={locale}>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>{t.operations}</PageShellTitle>
					<PageShellDescription>{t.operationsIntro}</PageShellDescription>
				</PageShellHeading>
				<PageShellActions>
					<OperationsLanguage />
				</PageShellActions>
			</PageShellHeader>
			<WorkspaceToolbar>
				<div className="flex flex-wrap items-center gap-3">
					<span
						id="operations-period-label"
						className="text-sm text-muted-foreground"
					>
						{t.period}
					</span>
					<Select
						value={String(hours)}
						onValueChange={(value) => setHours(Number(value) as 24 | 168)}
					>
						<SelectTrigger aria-labelledby="operations-period-label">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="24">{t.lastDay}</SelectItem>
							<SelectItem value="168">{t.lastWeek}</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						variant="outline"
						disabled={
							capabilities.isFetching || overview.isFetching || forbidden
						}
						onClick={() => void refresh()}
					>
						<RefreshCw aria-hidden="true" />
						{t.refresh}
					</Button>
					<Button variant="ghost" asChild>
						<Link href={url("/agents")}>
							{t.agents}
							<ArrowUpRight aria-hidden="true" />
						</Link>
					</Button>
				</div>
			</WorkspaceToolbar>
			{showError && (
				<WorkspaceNotice tone="danger" role="alert">
					{forbidden ? t.adminOnly : t.operationsError}
				</WorkspaceNotice>
			)}
			{saved && (
				<WorkspaceNotice role="status">{t.decisionSaved}</WorkspaceNotice>
			)}
			{!showError &&
				(capabilities.isPending ||
					(capabilities.isSuccess && overview.isPending)) && (
					<div role="status" aria-label={t.loading} className="space-y-4">
						<span className="sr-only">{t.loading}</span>
						<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
							{[0, 1, 2, 3].map((item) => (
								<Skeleton key={item} className="h-20" />
							))}
						</div>
						<Skeleton className="h-64" />
					</div>
				)}
			{m && data && (
				<>
					<WorkspaceMetrics label={t.overview}>
						<WorkspaceMetric
							label={t.activeAgents}
							value={m.activeAgents.toLocaleString(locale)}
						/>
						<WorkspaceMetric
							label={t.runs}
							value={m.runCount.toLocaleString(locale)}
						/>
						<WorkspaceMetric
							label={t.cost}
							value={
								m.recordedAiCostUsd === null
									? t.unknown
									: `$${m.recordedAiCostUsd}`
							}
						/>
						<WorkspaceMetric
							label={t.pending}
							value={m.pendingApprovals ?? t.unknown}
							tone={m.pendingApprovals ? "warning" : "default"}
						/>
					</WorkspaceMetrics>
					{data.health.windowLimited && (
						<WorkspaceNotice tone="warning" role="alert">
							{t.coverageLimit}
						</WorkspaceNotice>
					)}
					<Tabs value={tab} onValueChange={setTab} className="min-w-0">
						<div className="min-w-0 overflow-x-auto">
							<TabsList aria-label={t.operations}>
								<TabsTrigger value="overview">{t.overview}</TabsTrigger>
								<TabsTrigger value="runs">{t.runs}</TabsTrigger>
								<TabsTrigger value="actions">{t.actions}</TabsTrigger>
								<TabsTrigger value="approvals">{t.approvals}</TabsTrigger>
								<TabsTrigger value="continuations">
									{t.continuations}
								</TabsTrigger>
							</TabsList>
						</div>
						<TabsContent value="overview" className="space-y-5 pt-4">
							{capabilities.data?.approvalsEnabled && !!m.pendingApprovals && (
								<WorkspaceToolbar>
									<p className="text-sm">
										{t.pending}:{" "}
										<strong className="tabular-nums">
											{m.pendingApprovals}
										</strong>
									</p>
									<Button
										wrap
										variant="outline"
										onClick={() => {
											setFilter("PENDING");
											setBefore(null);
											setTab("approvals");
										}}
									>
										{t.reviewApprovals}
										<ArrowUpRight aria-hidden="true" />
									</Button>
								</WorkspaceToolbar>
							)}
							<div className="grid items-start gap-5 xl:grid-cols-3">
								<div className="min-w-0 xl:col-span-2">
									<WorkspacePanel title={t.incident}>
										{!data.incidents.length ? (
											<Empty>
												<EmptyHeader>
													<EmptyDescription>{t.noIncidents}</EmptyDescription>
												</EmptyHeader>
											</Empty>
										) : (
											<ul className="divide-y">
												{data.incidents.map((i) => (
													<li
														key={i.actionId}
														className="flex flex-wrap items-start justify-between gap-3 py-4"
													>
														<div className="min-w-0 flex-1 space-y-2">
															<p className="text-sm font-medium">
																{i.agentName}
															</p>
															<OperationStatus
																value={
																	i.type === "AMBIGUOUS_OUTCOME"
																		? "RECONCILIATION_REQUIRED"
																		: "FAILED"
																}
																text={t}
															/>
															<p className="text-xs text-muted-foreground">
																{stamp(i.at)}
															</p>
															<details className="text-xs text-muted-foreground">
																<summary className="cursor-pointer">
																	{t.evidence}
																</summary>
																<p className="mt-2 break-all">
																	{i.errorCode ?? t.unknown} · {i.actionId}
																</p>
															</details>
														</div>
														<Button variant="outline" size="sm" asChild>
															<Link href={url(`/agents/${i.agentId}`)}>
																{t.openAgent}
																<ArrowUpRight aria-hidden="true" />
															</Link>
														</Button>
													</li>
												))}
											</ul>
										)}
										{!data.health.receiptCorrelationComplete && (
											<WorkspaceNotice tone="warning">
												{t.receiptCoverage}
											</WorkspaceNotice>
										)}
									</WorkspacePanel>
								</div>
								<WorkspacePanel title={t.health}>
									<dl className="space-y-4">
										<div>
											<dt className="text-xs leading-relaxed text-muted-foreground">
												{t.successRate}
											</dt>
											<dd className="mt-1 text-lg font-medium tabular-nums">
												{m.successRatePercent === null
													? t.unknown
													: `${m.successRatePercent}%`}
											</dd>
										</div>
										<div>
											<dt className="text-xs leading-relaxed text-muted-foreground">
												{t.missingCost}
											</dt>
											<dd className="mt-1 text-lg font-medium tabular-nums">
												{m.runsWithoutRecordedCost ?? t.unknown}
											</dd>
										</div>
									</dl>
									<p className="text-xs leading-relaxed text-muted-foreground">
										{t.costHelp}
									</p>
									<p className="text-xs leading-relaxed text-muted-foreground">
										{t.providerUnknown}
									</p>
									<p className="text-xs leading-relaxed text-muted-foreground">
										{t.noOutcomeLedger}
									</p>
									<p className="border-t pt-3 text-xs text-muted-foreground">
										{t.lastSnapshot}: {stamp(data.health.readAt)}
									</p>
								</WorkspacePanel>
							</div>
						</TabsContent>
						<TabsContent value="runs" className="space-y-4 pt-4">
							<p className="text-xs leading-relaxed text-muted-foreground">
								{t.recentLimit}
							</p>
							<WorkspacePanel title={t.runs}>
								{!data.runs.length ? (
									<Empty>
										<EmptyHeader>
											<EmptyDescription>{t.noRuns}</EmptyDescription>
										</EmptyHeader>
										<Button variant="outline" asChild>
											<Link href={url("/agents")}>
												{t.agents}
												<ArrowUpRight aria-hidden="true" />
											</Link>
										</Button>
									</Empty>
								) : (
									<section
										className="overflow-auto"
										// biome-ignore lint/a11y/noNoninteractiveTabindex: This bounded viewport must support keyboard scrolling.
										tabIndex={0}
										aria-label={t.runs}
									>
										<table className="w-full text-left text-sm">
											<caption className="sr-only">{t.runs}</caption>
											<thead>
												<tr>
													{[t.agent, t.status, t.atTime, t.cost].map((h) => (
														<th
															scope="col"
															key={h}
															className="border-b px-3 py-3 text-xs font-medium text-muted-foreground"
														>
															{h}
														</th>
													))}
												</tr>
											</thead>
											<tbody>
												{data.runs.map((run) => (
													<tr key={run.id} className="border-b last:border-0">
														<td className="min-w-48 px-3 py-4">
															<Link
																className="font-medium underline-offset-4 hover:underline"
																href={url(`/agents/${run.agentId}`)}
															>
																{run.agentName}
															</Link>
															<details className="mt-1 text-xs text-muted-foreground">
																<summary className="cursor-pointer">
																	{t.runId}
																</summary>
																<p className="mt-2 max-w-72 break-all">
																	{run.id}
																</p>
															</details>
														</td>
														<td className="px-3 py-4">
															<OperationStatus value={run.status} text={t} />
															{run.errorCode && (
																<p className="mt-2 break-all text-xs text-destructive">
																	{run.errorCode}
																</p>
															)}
														</td>
														<td className="whitespace-nowrap px-3 py-4 text-xs">
															{stamp(run.createdAt)}
														</td>
														<td className="whitespace-nowrap px-3 py-4 tabular-nums">
															{run.costUsd === null
																? t.unknown
																: `$${run.costUsd}`}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</section>
								)}
							</WorkspacePanel>
						</TabsContent>
						<TabsContent value="actions" className="space-y-4 pt-4">
							<p className="text-xs leading-relaxed text-muted-foreground">
								{t.recentLimit}
							</p>
							<WorkspacePanel title={t.actions}>
								{!data.actions.length ? (
									<Empty>
										<EmptyHeader>
											<EmptyDescription>{t.noActions}</EmptyDescription>
										</EmptyHeader>
									</Empty>
								) : (
									<ul className="divide-y">
										{data.actions.map((action) => (
											<li key={action.id} className="space-y-3 py-4">
												<div className="flex flex-wrap items-start justify-between gap-3">
													<div className="min-w-0">
														<h2 className="break-words text-sm font-medium">
															{action.type}
														</h2>
														<p className="mt-1 text-xs text-muted-foreground">
															{action.agentName} · {action.provider}
														</p>
													</div>
													<OperationStatus
														value={
															action.reconciliationRequired
																? "RECONCILIATION_REQUIRED"
																: action.status
														}
														text={t}
													/>
												</div>
												{action.reconciliationRequired && (
													<WorkspaceNotice tone="warning" role="status">
														{t.ambiguous}
													</WorkspaceNotice>
												)}
												<details className="text-xs text-muted-foreground">
													<summary className="cursor-pointer">
														{t.evidence}
													</summary>
													<p className="mt-2 break-all">
														{action.id} · {t.runId}: {action.runId}
													</p>
													{action.targetId && (
														<p className="mt-2 break-all">
															{action.targetType}: {action.targetId}
														</p>
													)}
												</details>
												<div className="flex flex-wrap items-center justify-between gap-3">
													<p className="text-xs text-muted-foreground">
														{stamp(action.plannedAt)}
													</p>
													<Button variant="ghost" size="sm" asChild>
														<Link href={url(`/agents/${action.agentId}`)}>
															{t.openAgent}
															<ArrowUpRight aria-hidden="true" />
														</Link>
													</Button>
												</div>
											</li>
										))}
									</ul>
								)}
							</WorkspacePanel>
						</TabsContent>
						<TabsContent value="approvals" className="space-y-4 pt-4">
							<p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
								{capabilities.data?.continuationsEnabled
									? t.continuationHelp
									: t.approvalHelp}
							</p>
							{!capabilities.data?.approvalsEnabled ? (
								<WorkspaceNotice>{t.approvalDisabled}</WorkspaceNotice>
							) : (
								<>
									<WorkspaceToolbar>
										<div className="flex flex-wrap items-center gap-3">
											<span
												id="approval-filter-label"
												className="text-sm text-muted-foreground"
											>
												{t.status}
											</span>
											<Select
												value={filter}
												disabled={decide.isPending}
												onValueChange={(value) => {
													setFilter(value as (typeof FILTERS)[number]);
													setBefore(null);
													setSaved(false);
												}}
											>
												<SelectTrigger aria-labelledby="approval-filter-label">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{FILTERS.map((f) => (
														<SelectItem key={f} value={f}>
															{f === "ALL" ? t.all : state(f)}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
										{approvals.data && (
											<p className="text-xs text-muted-foreground">
												{t.recordsShown}:{" "}
												<span className="tabular-nums">
													{approvals.data.items.length}
												</span>
											</p>
										)}
									</WorkspaceToolbar>
									{approvals.isPending ? (
										<div role="status" aria-label={t.loading}>
											<span className="sr-only">{t.loading}</span>
											<Skeleton className="h-48" />
										</div>
									) : approvals.isError ? null : !approvals.data?.items
											.length ? (
										<WorkspacePanel title={t.approvals}>
											<Empty>
												<EmptyHeader>
													<EmptyDescription>{t.noApprovals}</EmptyDescription>
												</EmptyHeader>
												{filter !== "ALL" && (
													<Button
														variant="outline"
														onClick={() => {
															setFilter("ALL");
															setBefore(null);
														}}
													>
														{t.all}
													</Button>
												)}
											</Empty>
										</WorkspacePanel>
									) : (
										<div className="space-y-4">
											{approvals.data.items.map((row) => (
												<WorkspacePanel
													key={row.id}
													title={row.snapshot?.title ?? row.actionId}
													action={
														<OperationStatus value={row.status} text={t} />
													}
												>
													<dl className="grid gap-4 text-sm sm:grid-cols-2">
														<div>
															<dt className="text-xs text-muted-foreground">
																{t.requester}
															</dt>
															<dd className="mt-1 break-all">
																{row.requesterUserId ?? row.requestedById}
															</dd>
														</div>
														<div>
															<dt className="text-xs text-muted-foreground">
																{t.expires}
															</dt>
															<dd className="mt-1">{stamp(row.expiresAt)}</dd>
														</div>
														{row.snapshot && (
															<div>
																<dt className="text-xs text-muted-foreground">
																	{t.approvalRisk}
																</dt>
																<dd className="mt-1">
																	{approvalRisk(row.snapshot.risk, t)}
																</dd>
															</div>
														)}
													</dl>
													{row.legacyUnbound ? (
														<WorkspaceNotice tone="warning">
															{t.legacyApproval}
														</WorkspaceNotice>
													) : (
														<details className="space-y-3">
															<summary className="cursor-pointer text-sm font-medium">
																{t.evidence}
															</summary>
															{row.snapshot &&
																!row.snapshot.previewComplete && (
																	<WorkspaceNotice tone="warning">
																		{t.incompletePreview}
																	</WorkspaceNotice>
																)}
															<section
																className="max-h-80 overflow-auto"
																aria-label={t.evidence} // biome-ignore lint/a11y/noNoninteractiveTabindex: This bounded viewport must support keyboard scrolling.
																tabIndex={0}
															>
																<pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
																	{JSON.stringify(
																		row.snapshot?.preview,
																		null,
																		2,
																	)}
																</pre>
															</section>
															<p className="break-all text-xs text-muted-foreground">
																{row.actionId} ·{" "}
																{row.snapshot?.manifestVersion ?? t.unknown}
															</p>
															{row.runId && (
																<p className="break-all text-xs text-muted-foreground">
																	{t.runId}: {row.runId}
																</p>
															)}
															<p className="break-all font-mono text-xs text-muted-foreground">
																SHA-256: {row.payloadDigest}
															</p>
														</details>
													)}
													{(row.canApprove ||
														row.canReject ||
														row.canCancel) && (
														<div className="flex flex-wrap gap-2 border-t pt-4">
															{row.canApprove && (
																<Button
																	disabled={
																		!mayDecideApproval(row, "APPROVED") ||
																		decide.isPending ||
																		approvals.isFetching
																	}
																	onClick={() => choose(row, "APPROVED")}
																>
																	{t.approve}
																</Button>
															)}
															{row.canReject && (
																<Button
																	variant="outline"
																	disabled={
																		decide.isPending ||
																		approvals.isFetching ||
																		!mayDecideApproval(row, "REJECTED")
																	}
																	onClick={() => choose(row, "REJECTED")}
																>
																	{t.reject}
																</Button>
															)}
															{row.canCancel && (
																<Button
																	wrap
																	variant="ghost"
																	disabled={
																		decide.isPending ||
																		approvals.isFetching ||
																		!mayDecideApproval(row, "CANCELLED")
																	}
																	onClick={() => choose(row, "CANCELLED")}
																>
																	{t.revokeApproval}
																</Button>
															)}
														</div>
													)}
												</WorkspacePanel>
											))}
										</div>
									)}
									<nav
										aria-label={t.approvals}
										className="flex flex-wrap justify-end gap-2"
									>
										<Button
											variant="outline"
											disabled={
												!before || decide.isPending || approvals.isFetching
											}
											onClick={() => setBefore(null)}
										>
											{t.first}
										</Button>
										<Button
											variant="outline"
											disabled={
												!approvals.data?.next ||
												approvals.isFetching ||
												approvals.isError ||
												decide.isPending
											}
											onClick={() => setBefore(approvals.data?.next ?? null)}
										>
											{t.next}
										</Button>
									</nav>
								</>
							)}
						</TabsContent>
						<TabsContent value="continuations" className="pt-4">
							<ContinuationsPanel
								enabled={capabilities.data?.continuationsEnabled === true}
								active={tab === "continuations"}
							/>
						</TabsContent>
					</Tabs>
				</>
			)}
			<AlertDialog
				open={selected !== null}
				onOpenChange={(open) => {
					if (!open) setSelected(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t.decisionTitle}</AlertDialogTitle>
						<AlertDialogDescription>
							{capabilities.data?.continuationsEnabled
								? t.continuationHelp
								: t.approvalHelp}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<p className="break-words text-sm font-medium">
						{selected?.row.snapshot?.title ?? selected?.row.actionId} ·{" "}
						{selected ? state(selected.decision) : ""}
					</p>
					<label htmlFor="approval-decision-note" className="space-y-2 text-sm">
						{t.decisionNote}
						<Textarea
							id="approval-decision-note"
							maxLength={500}
							rows={4}
							value={note}
							onChange={(e) => setNote(e.target.value)}
						/>
					</label>
					<AlertDialogFooter>
						<AlertDialogCancel>{t.back}</AlertDialogCancel>
						<AlertDialogAction
							disabled={
								decide.isPending ||
								!selected ||
								!mayDecideApproval(selected.row, selected.decision)
							}
							onClick={() => void confirm()}
						>
							{t.confirm}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
