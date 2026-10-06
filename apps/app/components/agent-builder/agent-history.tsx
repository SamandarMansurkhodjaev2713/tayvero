"use client";

import ChevronDown from "@carbon/icons-react/es/ChevronDown";
import ChevronUp from "@carbon/icons-react/es/ChevronUp";
import Download from "@carbon/icons-react/es/Download";
import Renew from "@carbon/icons-react/es/Renew";
import WarningAlt from "@carbon/icons-react/es/WarningAlt";
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
import { Icon } from "@crm/ui/components/icon";
import { cn } from "@crm/ui/lib/utils";
import { useState } from "react";
import { z } from "zod";
import { LocalDateTime } from "@/components/local-date-time";
import { runFailureReason } from "@/lib/agent-run-failure";
import type { RouterOutputs } from "@/lib/trpc/types";

type Runs = RouterOutputs["agents"]["history"];
type Activity = RouterOutputs["agents"]["activity"];
type RunRow = Runs[number];
type AuditRow = Activity[number];

const runEvents = z.array(
	z.object({
		id: z.string(),
		type: z.string(),
		data: z.json(),
		emittedAt: z.string(),
	}),
);

type RunEvent = z.infer<typeof runEvents>[number];

const eventSummary = z
	.object({ summary: z.string().refine((text) => text.trim().length > 0) })
	.transform((event) => event.summary)
	.nullable()
	.catch(null);

const auditChange = z.object({ before: z.json(), after: z.json() });

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	second: "2-digit",
	timeZoneName: "short",
};
const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
};

export function AgentRuns({
	runs,
	onCancel,
	cancelling,
	onRetry,
	retryingRunId,
	selectedRunId,
}: {
	runs: Runs;
	onCancel: (runId: string) => void;
	cancelling: boolean;
	onRetry: (runId: string) => void;
	retryingRunId?: string;
	selectedRunId?: string;
}) {
	const [outcome, setOutcome] = useState("ALL");
	const [expanded, setExpanded] = useState<string | null>(
		selectedRunId ?? null,
	);
	const [confirming, setConfirming] = useState<string | null>(null);
	const visible = runs.filter(
		(run) => outcome === "ALL" || run.status === outcome,
	);

	return (
		<div className="flex min-w-0 flex-col gap-4 sm:gap-6">
			{selectedRunId && !runs.some((run) => run.id === selectedRunId) && (
				<p role="status" className="rounded-lg border p-4 text-sm leading-6">
					The requested run is not in this loaded history. It may be older than
					the latest runs shown here. No result for this reference has been
					loaded:{" "}
					<span className="wrap-anywhere font-mono text-xs">
						{selectedRunId}
					</span>
					.
				</p>
			)}
			{selectedRunId &&
				runs.some((run) => run.id === selectedRunId) &&
				!visible.some((run) => run.id === selectedRunId) && (
					<p role="status" className="text-sm">
						The requested run is hidden by the outcome filter.{" "}
						<Button variant="link" onClick={() => setOutcome("ALL")}>
							Show all outcomes
						</Button>
					</p>
				)}
			<div className="flex min-h-7 items-center justify-start sm:justify-end">
				<select
					value={outcome}
					onChange={(event) => setOutcome(event.target.value)}
					aria-label="Filter run outcomes"
					className="h-7 rounded-md border bg-muted px-2.5 font-medium text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
				>
					<option value="ALL">All outcomes</option>
					<option value="SUCCEEDED">Succeeded</option>
					<option value="FAILED">Failed</option>
					<option value="RUNNING">Running</option>
					<option value="QUEUED">Queued</option>
					<option value="WAITING_FOR_APPROVAL">Waiting for approval</option>
					<option value="CANCELLED">Cancelled</option>
				</select>
			</div>

			{visible.map((run) => (
				<div
					key={run.id}
					id={`run-${run.id}`}
					className="min-w-0 overflow-hidden rounded-lg border bg-card"
				>
					<div className="flex min-w-0 flex-col items-stretch sm:flex-row">
						<button
							type="button"
							aria-expanded={expanded === run.id}
							onClick={() =>
								setExpanded((current) => (current === run.id ? null : run.id))
							}
							className="flex min-h-14 w-full min-w-0 flex-col items-stretch gap-3 px-4 py-3 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40 sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:px-5 sm:py-2"
						>
							<span className="min-w-0 flex-1">
								<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
									<span className="font-semibold text-sm">
										Run <span className="font-mono">{run.id.slice(0, 8)}</span>
									</span>
									<span
										className={cn(
											"text-muted-foreground text-xs",
											run.status === "FAILED" && "text-destructive",
										)}
									>
										{humanStatus(run.status)}
									</span>
								</span>
								<span className="mt-1 block wrap-break-word font-mono text-muted-foreground text-xs leading-5 sm:mt-0">
									{humanStatus(run.triggerType)} ·{" "}
									<LocalDateTime date={run.createdAt} options={DATE_OPTIONS} />{" "}
									· Version {run.version.number}
								</span>
								{run.status === "FAILED" || run.status === "CANCELLED" ? (
									<span className="mt-1.5 flex min-w-0 items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-1.5">
										<Icon
											icon={WarningAlt}
											className="mt-px size-3.5 shrink-0 text-destructive"
										/>
										<span className="min-w-0 wrap-break-word text-destructive text-xs leading-5">
											{runFailureReason(run.errorCode, run.errorMessage)}
										</span>
									</span>
								) : null}
							</span>
							<span className="flex min-w-0 items-center justify-between gap-3 font-mono text-muted-foreground text-xs sm:shrink-0 sm:justify-start sm:gap-4">
								<span>{duration(run.startedAt, run.finishedAt)}</span>
								<span>
									{run.totalActions ?? run.actions.length} recorded{" "}
									{run.actions.length === 1 ? "action" : "actions"}
								</span>
								<Icon
									icon={expanded === run.id ? ChevronUp : ChevronDown}
									className="size-3.5"
								/>
							</span>
						</button>

						{run.status === "FAILED" || run.status === "CANCELLED" ? (
							<span className="flex shrink-0 items-center justify-end px-4 pb-3 sm:px-0 sm:pb-0 sm:pr-5">
								<Button
									variant="outline"
									size="sm"
									disabled={retryingRunId === run.id || run.canRetry !== true}
									title={
										run.retryBlockedReason ??
										(run.canRetry === true
											? `Repeat using version ${run.version.number}`
											: "Retry safety is unavailable from this API version")
									}
									onClick={() => onRetry(run.id)}
								>
									<Icon icon={Renew} data-icon="inline-start" />
									{retryingRunId === run.id
										? "Queueing…"
										: "Retry same version"}
								</Button>
							</span>
						) : null}

						{run.canCancel ? (
							<span className="flex shrink-0 items-center justify-end px-4 pb-3 sm:px-0 sm:pb-0 sm:pr-5">
								<Button
									variant="outline"
									size="sm"
									disabled={cancelling}
									onClick={() => setConfirming(run.id)}
								>
									Stop
								</Button>
							</span>
						) : null}
					</div>
					{["FAILED", "CANCELLED"].includes(run.status) ? (
						<p className="border-t px-4 py-3 text-xs text-muted-foreground leading-5 sm:px-5">
							{run.canRetry === true
								? `A retry creates a new run using version ${run.version.number}, not the latest edits.`
								: (run.retryBlockedReason ??
									"Retry safety is unavailable. Review the recorded actions before starting anything again.")}
						</p>
					) : null}
					{run.status === "WAITING_FOR_APPROVAL" ? (
						<p
							role="status"
							className="border-t px-4 py-3 text-sm text-muted-foreground sm:px-5"
						>
							An action is awaiting an authorized reviewer. Review the recorded
							steps below; starting another run will not bypass approval.
						</p>
					) : null}

					{expanded === run.id ? (
						<>
							{run.actionsTruncated ? (
								<p className="px-5 py-2 text-xs text-muted-foreground">
									Showing the first {run.actions.length} of {run.totalActions}{" "}
									actions. This is not the complete action history.
								</p>
							) : null}
							<ExpandedRun run={run} />
						</>
					) : null}
				</div>
			))}

			<AlertDialog
				open={confirming !== null}
				onOpenChange={(open) => setConfirming(open ? confirming : null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Stop this run?</AlertDialogTitle>
						<AlertDialogDescription>
							The agent stops where it is and the run is recorded as cancelled.
							Anything it has already done — a note, a task, a Slack message —
							stays done.
						</AlertDialogDescription>
					</AlertDialogHeader>

					<AlertDialogFooter>
						<AlertDialogCancel>Keep running</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => {
								if (confirming) onCancel(confirming);
								setConfirming(null);
							}}
						>
							Stop run
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{visible.length === 0 ? (
				<p className="py-12 text-center text-muted-foreground text-sm">
					{runs.length === 0
						? "No runs yet. Once this agent is active, choose Run now on its detail page, then check the result here. A queued request is not a completed result."
						: "No runs match this outcome. Choose All outcomes to see the latest runs."}
				</p>
			) : null}
		</div>
	);
}

function ExpandedRun({ run }: { run: RunRow }) {
	const events = runEvents.parse(run.events);
	const timeline = [
		...events.map((event) => ({
			kind: "event" as const,
			at: event.emittedAt,
			event,
		})),
		...run.actions.map((action) => ({
			kind: "action" as const,
			at: action.completedAt ?? action.startedAt ?? action.plannedAt,
			action,
		})),
	].sort((first, second) => Date.parse(first.at) - Date.parse(second.at));

	return (
		<div className="min-w-0 border-t">
			<section
				className="flex flex-col gap-2 border-b px-4 py-4 sm:px-5"
				aria-label="Run result"
			>
				<h3 className="text-sm font-semibold">Agent-generated report</h3>
				<p className="whitespace-pre-wrap wrap-break-word text-sm leading-6">
					{run.summary?.trim() ||
						(run.status === "SUCCEEDED"
							? "This run completed without a written report. Check the recorded actions below for its result."
							: "No written report has been recorded yet.")}
				</p>
				<p className="text-xs text-muted-foreground leading-5">
					{run.totalActions ?? run.actions.length} recorded actions ·{" "}
					{run.costUsd === null
						? "Cost not reported"
						: `Reported cost: $${run.costUsd}`}
					. Check the action statuses and references below to confirm what
					happened.
				</p>
			</section>
			<div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b bg-background px-4 py-3 sm:min-h-[58px] sm:grid-cols-4 sm:items-center sm:gap-0 sm:px-5 sm:py-2">
				<RunMeta label="Trigger" value={humanStatus(run.triggerType)} />
				<RunMeta
					label="Initiated by"
					value={run.initiatedBy?.name ?? "Eve scheduler"}
				/>
				<RunMeta label="Model" value={run.modelId ?? "Gateway default"} />
				<RunMeta label="Version" value={String(run.version.number)} last />
			</div>

			<div>
				{timeline.map((entry) =>
					entry.kind === "event" ? (
						<div
							key={`event:${entry.event.id}`}
							className="grid min-h-8 min-w-0 grid-cols-[68px_minmax(0,1fr)] items-start gap-x-3 border-t px-4 py-2 first:border-t-0 sm:flex sm:items-center sm:gap-5 sm:px-5 sm:py-1.5"
						>
							<span className="shrink-0 font-mono text-muted-foreground text-xs sm:w-[78px]">
								<LocalDateTime date={entry.at} options={TIME_OPTIONS} />
							</span>
							<span className="min-w-0 flex-1 wrap-break-word text-sm">
								{eventLabel(entry.event)}
							</span>
							<span className="hidden shrink-0 font-mono text-muted-foreground text-xs sm:inline">
								event
							</span>
						</div>
					) : (
						<div
							key={`action:${entry.action.id}`}
							className="grid min-h-12 min-w-0 grid-cols-[68px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 border-t px-4 py-3 first:border-t-0 sm:flex sm:gap-5 sm:px-5"
						>
							<span className="shrink-0 font-mono text-muted-foreground text-xs sm:w-[78px]">
								<LocalDateTime date={entry.at} options={TIME_OPTIONS} />
							</span>
							<span className="min-w-0 flex-1">
								<span className="block wrap-break-word text-sm">
									{entry.action.summary}
								</span>
								<span className="block wrap-break-word text-muted-foreground text-xs">
									{entry.action.provider} · {humanStatus(entry.action.status)}
									{entry.action.targetLabel
										? ` · ${entry.action.targetLabel}`
										: ""}
								</span>
								{entry.action.errorMessage || entry.action.errorCode ? (
									<span className="mt-1 block wrap-break-word text-destructive text-xs">
										{runFailureReason(
											entry.action.errorCode,
											entry.action.errorMessage,
										)}
									</span>
								) : null}
							</span>
							<span className="col-start-2 min-w-0 wrap-break-word font-mono text-muted-foreground text-xs sm:col-auto sm:shrink-0">
								{entry.action.externalId ?? entry.action.id.slice(0, 12)}
							</span>
						</div>
					),
				)}
				{run.eventsTruncated ? (
					<div className="flex min-h-9 items-center border-t px-4 py-2 text-warning text-xs sm:px-5">
						Showing the first {events.length} of {run.totalEvents} steps. This
						run is too long to display in full.
					</div>
				) : null}
			</div>
		</div>
	);
}

function RunMeta({
	label,
	value,
	last = false,
}: {
	label: string;
	value: string;
	last?: boolean;
}) {
	return (
		<span
			className={cn(
				"flex min-w-0 flex-col gap-0.5 sm:flex-1",
				last && "sm:max-w-44",
			)}
		>
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="wrap-break-word text-sm sm:truncate">{value}</span>
		</span>
	);
}

export function AgentActivity({ activity }: { activity: Activity }) {
	const [kind, setKind] = useState("ALL");
	const visible = activity.filter(
		(event) => kind === "ALL" || event.type.startsWith(kind),
	);

	return (
		<div className="flex min-w-0 flex-col gap-4 sm:gap-6">
			<div className="flex min-h-7 flex-wrap items-center justify-start gap-2 sm:justify-end sm:gap-3">
				<select
					value={kind}
					onChange={(event) => setKind(event.target.value)}
					aria-label="Filter activity"
					className="h-7 rounded-md border bg-muted px-2.5 font-medium text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
				>
					<option value="ALL">All changes</option>
					<option value="agent.">Agent changes</option>
					<option value="run.">Run requests</option>
				</select>
				<Button
					variant="outline"
					size="sm"
					onClick={() => exportJson("agent-activity.json", visible)}
				>
					<Icon icon={Download} data-icon="inline-start" />
					Export
				</Button>
			</div>

			<div className="min-w-0 overflow-hidden rounded-lg border bg-card">
				<div className="hidden h-9 items-center border-b bg-background px-5 text-muted-foreground text-xs sm:flex">
					<span className="w-[166px] shrink-0">Time</span>
					<span className="min-w-0 flex-1">Change</span>
					<span className="w-[140px] shrink-0">Actor</span>
					<span className="w-[118px] shrink-0 text-right">Request</span>
				</div>
				{visible.map((event) => (
					<div
						key={event.id}
						className="flex min-h-11 min-w-0 flex-col items-start gap-2 border-t px-4 py-3 first:border-t-0 sm:flex-row sm:items-center sm:gap-0 sm:px-5"
					>
						<span className="shrink-0 font-mono text-muted-foreground text-xs sm:w-[166px]">
							<LocalDateTime date={event.emittedAt} options={DATE_OPTIONS} />
						</span>
						<span className="min-w-0 flex-1">
							<span className="block wrap-break-word text-sm">
								{event.summary}
							</span>
							{changeDetail(event) ? (
								<span className="block max-w-full whitespace-pre-wrap wrap-break-word font-mono text-muted-foreground text-xs">
									{changeDetail(event)}
								</span>
							) : null}
						</span>
						<span className="min-w-0 wrap-break-word text-xs sm:w-[140px] sm:shrink-0 sm:text-sm">
							<span className="text-muted-foreground sm:hidden">Actor · </span>
							{event.actorUser?.name ?? event.actorId ?? event.actorType}
						</span>
						<span className="min-w-0 wrap-break-word font-mono text-muted-foreground text-xs sm:w-[118px] sm:shrink-0 sm:text-right">
							<span className="font-sans sm:hidden">Request · </span>
							{event.requestId?.slice(0, 12) ?? "—"}
						</span>
					</div>
				))}
				{visible.length === 0 ? (
					<p className="px-5 py-12 text-center text-muted-foreground text-sm">
						No changes match this filter.
					</p>
				) : null}
			</div>
		</div>
	);
}

function humanStatus(value: string): string {
	return value
		.toLowerCase()
		.replace(/_/g, " ")
		.replace(/^./, (character) => character.toUpperCase());
}

function duration(startedAt: string | null, finishedAt: string | null): string {
	if (!startedAt) return "—";
	if (!finishedAt) return "In progress";

	const milliseconds =
		new Date(finishedAt).getTime() - new Date(startedAt).getTime();
	return `${Math.max(0, milliseconds / 1000).toFixed(1)}s`;
}

function eventLabel(event: RunEvent): string {
	return (
		eventSummary.parse(event.data) ??
		humanStatus(event.type.replace(/\./g, " "))
	);
}

function changeDetail(event: AuditRow): string | null {
	const { before, after } = auditChange.parse(event);
	if (!before && !after) return null;
	const previous = JSON.stringify(before);
	const next = JSON.stringify(after);
	return previous && next ? `${previous} → ${next}` : next || previous;
}

function exportJson(name: string, value: readonly AuditRow[]) {
	const url = URL.createObjectURL(
		new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
	);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = name;
	anchor.click();
	URL.revokeObjectURL(url);
}
