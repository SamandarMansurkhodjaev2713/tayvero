"use client";

import { Button } from "@crm/ui/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { Skeleton } from "@crm/ui/components/skeleton";
import {
	WorkspaceNotice,
	WorkspacePanel,
	WorkspaceStatus,
} from "@crm/ui/components/workspace";
import Link from "next/link";
import type { ReactNode } from "react";
import { LocalDateTime } from "@/components/local-date-time";
import type { RouterOutputs } from "@/lib/trpc/types";
import { type FollowUpState, groupFollowUps } from "./follow-up-model.mjs";

type Task = RouterOutputs["activities"]["myTasks"][number];
type Queue = RouterOutputs["activities"]["taskQueue"];
export type TaskStatusFilter = "open" | "completed" | "all";
export type TaskQueueScope = "me" | "team";
export const TASK_PAGE_SIZE = 25;
type Props = {
	tasks: Task[];
	now: Date | null;
	state: FollowUpState;
	scope: TaskQueueScope;
	status: TaskStatusFilter;
	page: number;
	total: number;
	counts?: Queue["counts"];
	responsibleFilter?: ReactNode;
	responsibleFiltered?: boolean;
	isFetching: boolean;
	pendingId?: string;
	error?: string;
	feedback?: string;
	workspaceUrl: (path: string) => string;
	onRefresh: () => void;
	onComplete: (id: string, completed: boolean) => void;
	onEdit: (id: string) => void;
	onScopeChange: (scope: TaskQueueScope) => void;
	onStatusChange: (status: TaskStatusFilter) => void;
	onPageChange: (page: number) => void;
};

export function FollowUpQueueView(props: Props) {
	const { state, now, tasks, isFetching, onRefresh } = props;
	const loaded = (state === "ready" || state === "stale") && now !== null;
	const groups = loaded ? groupFollowUps(tasks, now) : null;
	const completed = tasks.filter((task) => task.completedAt !== null);
	const busy = Boolean(props.pendingId) || isFetching;
	return (
		<WorkspacePanel
			title="Tasks and follow-ups"
			description={
				props.scope === "me"
					? "Mine: tasks assigned to you. Creation and responsibility are tracked separately."
					: "Team: tasks across the workspace, including unassigned work."
			}
			action={
				<Button variant="outline" size="sm" disabled={busy} onClick={onRefresh}>
					{isFetching ? "Refreshing…" : "Refresh tasks"}
				</Button>
			}
		>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<fieldset
					aria-label="Task and overview scope"
					className="flex flex-wrap gap-2"
				>
					<Button
						size="sm"
						variant={props.scope === "me" ? "default" : "outline"}
						aria-pressed={props.scope === "me"}
						disabled={busy}
						onClick={() => props.onScopeChange("me")}
					>
						Mine
					</Button>
					<Button
						size="sm"
						variant={props.scope === "team" ? "default" : "outline"}
						aria-pressed={props.scope === "team"}
						disabled={busy}
						onClick={() => props.onScopeChange("team")}
					>
						Team
					</Button>
				</fieldset>
				<Select
					value={props.status}
					disabled={busy}
					onValueChange={(value) =>
						props.onStatusChange(value as TaskStatusFilter)
					}
				>
					<SelectTrigger aria-label="Task completion filter" className="w-40">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="open">Open tasks</SelectItem>
						<SelectItem value="completed">Completed tasks</SelectItem>
						<SelectItem value="all">All tasks</SelectItem>
					</SelectContent>
				</Select>
			</div>
			{props.scope === "team" && props.responsibleFilter && (
				<div className="mb-4 max-w-sm">{props.responsibleFilter}</div>
			)}
			<p className="mb-4 text-xs text-muted-foreground">
				Mine / Team also changes the overview scope. Deadlines use your device’s
				calendar day; earlier-today tasks may already be past their scheduled
				time.
			</p>
			{state === "loading" && (
				<div
					role="status"
					aria-label="Loading task queue"
					className="space-y-3"
				>
					<Skeleton className="h-12 w-full" />
					<Skeleton className="h-12 w-full" />
					<span className="sr-only">
						Loading tasks and your local calendar day…
					</span>
				</div>
			)}
			{state === "error" && (
				<WorkspaceNotice role="alert" tone="danger">
					<p className="font-medium">Tasks could not be loaded</p>
					<p className="mt-1">
						Refresh the queue. No task counts are available yet.
					</p>
				</WorkspaceNotice>
			)}
			{state === "stale" && (
				<WorkspaceNotice role="status" tone="warning" className="mb-4">
					The latest refresh failed. This is the previous snapshot; refresh
					before changing or completing a task.
				</WorkspaceNotice>
			)}
			{props.error && (
				<WorkspaceNotice role="alert" tone="danger" className="mb-4">
					The task could not be changed: {props.error}. Refresh the current task
					before trying again.
				</WorkspaceNotice>
			)}
			{props.feedback && (
				<p role="status" className="mb-3 text-sm text-muted-foreground">
					{props.feedback}
				</p>
			)}
			{groups && (
				<>
					{props.counts && (
						<p className="mb-2 text-sm text-muted-foreground">
							Scope totals: {props.counts.open} open · {props.counts.completed}{" "}
							completed · {props.counts.unassigned} unassigned. These totals are
							independent of the completion filter.
							{props.responsibleFiltered
								? " They apply to the selected responsible-person filter."
								: " They cover all responsibility in this scope."}
						</p>
					)}
					<p className="mb-4 text-xs text-muted-foreground">
						{tasks.length
							? `Showing ${props.page * TASK_PAGE_SIZE + 1}–${props.page * TASK_PAGE_SIZE + tasks.length} of ${props.total} matching tasks.`
							: `0 tasks shown on this page; ${props.total} match this view.`}{" "}
						Group counts describe this page, up to {TASK_PAGE_SIZE} tasks,
						earliest deadlines first.
					</p>
					{tasks.length === 0 ? (
						<div className="space-y-3">
							<p className="text-sm text-muted-foreground">
								{props.total > 0
									? "This page no longer has tasks. Return to the first page or choose another view."
									: props.scope === "me"
										? "No tasks assigned to you match this view. Create a task from a record’s activity timeline or check Team for unassigned work."
										: "No team tasks match this view. Create a task from a company, contact or deal’s activity timeline."}
							</p>
							<div className="flex flex-wrap gap-2">
								{props.page > 0 && (
									<Button
										variant="outline"
										onClick={() => props.onPageChange(0)}
									>
										Return to first page
									</Button>
								)}
								<Button asChild variant="outline">
									<Link href={props.workspaceUrl("/deals")}>Open deals</Link>
								</Button>
							</div>
						</div>
					) : (
						// biome-ignore-start lint/a11y/noNoninteractiveTabindex: This bounded task list scrolls independently; focus enables keyboard scrolling.
						<section
							aria-label="Tasks on the current page"
							tabIndex={0}
							className="max-h-128 overflow-y-auto divide-y divide-border rounded-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
						>
							{props.status !== "completed" && (
								<>
									<FollowUpGroup
										label="Overdue"
										tasks={groups.overdue}
										tone="danger"
										props={props}
									/>
									<FollowUpGroup
										label="Today"
										tasks={groups.today}
										tone="neutral"
										props={props}
									/>
									<FollowUpGroup
										label="Without a due date / date to review"
										tasks={groups.undated}
										tone="warning"
										props={props}
									/>
									<details className="py-4">
										<summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4">
											Later · {groups.upcoming.length} on this page
										</summary>
										<TaskList tasks={groups.upcoming} props={props} />
									</details>
								</>
							)}
							{props.status !== "open" && (
								<FollowUpGroup
									label="Completed"
									tasks={completed}
									tone="success"
									props={props}
								/>
							)}
						</section>
						// biome-ignore-end lint/a11y/noNoninteractiveTabindex: End the single keyboard-scroll region exception.
					)}
					<div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
						<p className="text-xs text-muted-foreground">
							Page {props.page + 1} · {props.total} matching tasks
						</p>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={busy || props.page === 0}
								onClick={() => props.onPageChange(props.page - 1)}
							>
								Previous page
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={
									busy || (props.page + 1) * TASK_PAGE_SIZE >= props.total
								}
								onClick={() => props.onPageChange(props.page + 1)}
							>
								Next page
							</Button>
						</div>
					</div>
				</>
			)}
		</WorkspacePanel>
	);
}

function FollowUpGroup({
	label,
	tasks,
	tone,
	props,
}: {
	label: string;
	tasks: Task[];
	tone: "danger" | "neutral" | "warning" | "success";
	props: Props;
}) {
	return (
		<section className="py-4 first:pt-0">
			<h3 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
				{label}
				<WorkspaceStatus tone={tone}>
					{tasks.length} on this page
				</WorkspaceStatus>
			</h3>
			{tasks.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No tasks in this group on the loaded page.
				</p>
			) : (
				<TaskList tasks={tasks} props={props} />
			)}
		</section>
	);
}

function TaskList({ tasks, props }: { tasks: Task[]; props: Props }) {
	return (
		<ul className="divide-y divide-border">
			{tasks.map((task) => {
				const subject = task.subject?.trim() || "Untitled task";
				const record = task.deal
					? { path: "deals", id: task.deal.id, name: task.deal.name }
					: task.contact
						? {
								path: "contacts",
								id: task.contact.id,
								name:
									[task.contact.firstName, task.contact.lastName]
										.filter(Boolean)
										.join(" ") || "Contact",
							}
						: task.company
							? {
									path: "companies",
									id: task.company.id,
									name: task.company.name,
								}
							: null;
				const validDate =
					task.dueAt !== null &&
					Number.isFinite(new Date(task.dueAt).getTime());
				const blocked =
					Boolean(props.pendingId) ||
					props.state === "stale" ||
					props.isFetching;
				return (
					<li
						key={task.id}
						className="flex min-w-0 flex-wrap items-start justify-between gap-3 py-3"
					>
						<div className="min-w-0 flex-1 basis-48 space-y-1">
							<p className="wrap-anywhere text-sm font-medium">{subject}</p>
							<p className="wrap-anywhere text-sm text-muted-foreground">
								{record ? (
									<Link
										className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
										href={props.workspaceUrl(
											`/${record.path}/${encodeURIComponent(record.id)}`,
										)}
									>
										{record.name}
									</Link>
								) : (
									"No linked record"
								)}
							</p>
							<p className="wrap-anywhere text-xs text-muted-foreground">
								Responsible: {task.assignee?.name || "Unassigned"}
								{task.assigneeActive === false
									? " (no longer an active member)"
									: ""}{" "}
								· Created by {task.createdBy.name}
							</p>
							<p className="text-xs text-muted-foreground">
								{validDate && task.dueAt ? (
									<LocalDateTime
										date={task.dueAt}
										options={{
											month: "short",
											day: "numeric",
											year: "numeric",
											hour: "numeric",
											minute: "2-digit",
											timeZoneName: "short",
										}}
									/>
								) : task.dueAt ? (
									"Invalid due date — review the record"
								) : (
									"No due date"
								)}
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							<Button
								variant="ghost"
								size="sm"
								disabled={blocked}
								aria-label={`Details and history for ${subject}`}
								onClick={() => props.onEdit(task.id)}
							>
								{task.taskPermissions?.canEdit ? "Edit / history" : "History"}
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={blocked || task.taskPermissions?.canEdit !== true}
								aria-label={`${task.completedAt ? "Reopen" : "Mark as done:"} ${subject}`}
								onClick={() =>
									props.onComplete(task.id, task.completedAt === null)
								}
							>
								{props.pendingId === task.id
									? "Saving…"
									: task.completedAt
										? "Reopen"
										: "Done"}
							</Button>
						</div>
					</li>
				);
			})}
		</ul>
	);
}
