"use client";

import { Button } from "@crm/ui/components/button";
import { Skeleton } from "@crm/ui/components/skeleton";
import { WorkspaceNotice } from "@crm/ui/components/workspace";
import { useQuery } from "@tanstack/react-query";
import { LocalDateTime } from "@/components/local-date-time";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type Task = RouterOutputs["activities"]["taskById"];
type History = RouterOutputs["activities"]["taskHistory"];
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
	month: "short",
	day: "numeric",
	year: "numeric",
	hour: "numeric",
	minute: "2-digit",
	timeZoneName: "short",
};
const LABELS = {
	CREATED: "Created",
	UPDATED: "Changed",
	COMPLETED: "Completed",
	REOPENED: "Reopened",
};

export function TaskHistory({ task }: { task: Task }) {
	const trpc = useTRPC();
	const history = useQuery(
		trpc.activities.taskHistory.queryOptions({ id: task.id, limit: 50 }),
	);
	return (
		<section className="min-w-0 space-y-3" aria-label="Task change history">
			<h3 className="text-sm font-medium">History</h3>
			{history.isPending && (
				<div role="status" aria-label="Loading task history">
					<Skeleton className="h-16 w-full" />
				</div>
			)}
			{history.isError && (
				<WorkspaceNotice role="alert" tone="warning">
					<p>
						Task history could not refresh. Previously loaded events may be
						shown.
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="mt-2"
						onClick={() => void history.refetch()}
						disabled={history.isFetching}
					>
						Refresh history
					</Button>
				</WorkspaceNotice>
			)}
			{history.data && <TaskHistoryList events={history.data} task={task} />}
		</section>
	);
}

export function TaskHistoryList({
	events,
	task,
}: {
	events: History;
	task: Task;
}) {
	const nameOf = (id: string | null, snapshot: string | null) =>
		id === null
			? "Unassigned"
			: snapshot ||
				(id === task.assignee?.id
					? task.assignee.name
					: id === task.createdBy.id
						? task.createdBy.name
						: "Former or unavailable member");
	return (
		<>
			<p className="text-xs text-muted-foreground">
				Latest {events.length} recorded changes, up to 50. Older tasks may have
				no event for their original creation.
			</p>
			{events.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No change history has been recorded for this task.
				</p>
			) : (
				<ol className="divide-y divide-border">
					{events.map((event) => (
						<li key={event.id} className="space-y-1 py-3">
							<p className="wrap-anywhere text-sm font-medium">
								{LABELS[event.action]} by {event.actor.name} · version{" "}
								{event.taskVersion}
							</p>
							<p className="text-xs text-muted-foreground">
								<LocalDateTime date={event.createdAt} options={DATE_OPTIONS} />
							</p>
							{event.before &&
								event.before.assigneeId !== event.after.assigneeId && (
									<p className="wrap-anywhere text-sm text-muted-foreground">
										Responsible:{" "}
										{nameOf(event.before.assigneeId, event.before.assigneeName)}{" "}
										→ {nameOf(event.after.assigneeId, event.after.assigneeName)}
									</p>
								)}
							{event.before && event.before.dueAt !== event.after.dueAt && (
								<p className="text-sm text-muted-foreground">
									Due: <HistoryDeadline date={event.before.dueAt} /> →{" "}
									<HistoryDeadline date={event.after.dueAt} />
								</p>
							)}
							{event.action === "CREATED" && (
								<p className="wrap-anywhere text-sm text-muted-foreground">
									Responsible:{" "}
									{nameOf(event.after.assigneeId, event.after.assigneeName)} ·
									Due: <HistoryDeadline date={event.after.dueAt} />
								</p>
							)}
						</li>
					))}
				</ol>
			)}
		</>
	);
}

function HistoryDeadline({ date }: { date: string | null }) {
	return date ? (
		<LocalDateTime date={date} options={DATE_OPTIONS} />
	) : (
		"No due date"
	);
}
