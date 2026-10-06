"use client";

import { Button } from "@crm/ui/components/button";
import { Skeleton } from "@crm/ui/components/skeleton";
import {
	WorkspaceNotice,
	WorkspacePanel,
	WorkspaceStatus,
} from "@crm/ui/components/workspace";
import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import type { RouterOutputs } from "@/lib/trpc/types";
import {
	FOLLOW_UP_LIMIT,
	type FollowUpState,
	groupFollowUps,
} from "./follow-up-model.mjs";

type Task = RouterOutputs["activities"]["myTasks"][number];
type Props = {
	tasks: Task[];
	now: Date | null;
	state: FollowUpState;
	isFetching: boolean;
	pendingId?: string;
	error?: string;
	feedback?: string;
	workspaceUrl: (path: string) => string;
	onRefresh: () => void;
	onComplete: (id: string) => void;
};

export function FollowUpQueueView(props: Props) {
	const { state, now, tasks, isFetching, onRefresh } = props;
	const loaded = (state === "ready" || state === "stale") && now !== null;
	const groups = loaded ? groupFollowUps(tasks, now) : null;
	return (
		<WorkspacePanel
			title="Your follow-ups"
			description="Tasks you created · grouped by your browser’s calendar day."
			action={
				<Button
					variant="outline"
					size="sm"
					disabled={isFetching}
					onClick={onRefresh}
				>
					{isFetching ? "Refreshing…" : "Refresh tasks"}
				</Button>
			}
		>
			{state === "loading" && (
				<div
					role="status"
					aria-label="Loading your follow-ups"
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
					<p className="font-medium">Your tasks could not be loaded</p>
					<p className="mt-1">
						Try refreshing the queue. No task counts are available yet.
					</p>
				</WorkspaceNotice>
			)}
			{state === "stale" && (
				<WorkspaceNotice role="status" tone="warning" className="mb-4">
					The latest refresh failed. This is the previous snapshot; refresh
					before completing a task.
				</WorkspaceNotice>
			)}
			{props.error && (
				<WorkspaceNotice role="alert" tone="danger" className="mb-4">
					The task could not be completed: {props.error}. Refresh or try again.
				</WorkspaceNotice>
			)}
			{props.feedback && (
				<p role="status" className="mb-3 text-sm text-muted-foreground">
					{props.feedback}
				</p>
			)}
			{groups && (
				<>
					<p className="mb-4 text-xs text-muted-foreground">
						Up to {FOLLOW_UP_LIMIT} open tasks, earliest deadlines first. Counts
						describe the loaded snapshot. Tasks earlier today may already be
						past their scheduled time.
					</p>
					{tasks.length >= FOLLOW_UP_LIMIT && (
						<WorkspaceNotice tone="warning" className="mb-4">
							The {FOLLOW_UP_LIMIT}-task limit was reached. Later tasks and
							tasks without a due date may be missing. Open the relevant record
							to review its full activity timeline.
						</WorkspaceNotice>
					)}
					{Object.values(groups).every((group) => group.length === 0) ? (
						<div className="space-y-3">
							<p className="text-sm text-muted-foreground">
								No open tasks in this loaded snapshot. Create a task from a
								company, contact or deal’s activity timeline.
							</p>
							<Button asChild variant="outline">
								<Link href={props.workspaceUrl("/deals")}>Open deals</Link>
							</Button>
						</div>
					) : (
						<div className="divide-y divide-border">
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
									Later · {groups.upcoming.length} loaded
								</summary>
								<TaskList tasks={groups.upcoming} props={props} />
							</details>
						</div>
					)}
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
	tone: "danger" | "neutral" | "warning";
	props: Props;
}) {
	return (
		<section className="py-4 first:pt-0">
			<h3 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
				{label}
				<WorkspaceStatus tone={tone}>{tasks.length} loaded</WorkspaceStatus>
			</h3>
			{tasks.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No tasks in this group in the loaded snapshot.
				</p>
			) : (
				<>
					<TaskList tasks={tasks.slice(0, 5)} props={props} />
					{tasks.length > 5 && (
						<details className="mt-2">
							<summary className="cursor-pointer rounded-sm text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4">
								Show {tasks.length - 5} remaining loaded tasks
							</summary>
							<TaskList tasks={tasks.slice(5)} props={props} />
						</details>
					)}
				</>
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
						<Button
							variant="outline"
							size="sm"
							disabled={
								Boolean(props.pendingId) ||
								props.state === "stale" ||
								props.isFetching
							}
							aria-label={`Mark ${subject} as done`}
							onClick={() => props.onComplete(task.id)}
						>
							{props.pendingId === task.id ? "Completing…" : "Done"}
						</Button>
					</li>
				);
			})}
		</ul>
	);
}
