"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { TaskAssigneePicker } from "@/components/crm/tasks/task-assignee-picker";
import { TaskEditor } from "@/components/crm/tasks/task-editor";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";
import { followUpLoadState } from "./follow-up-model.mjs";
import {
	FollowUpQueueView,
	TASK_PAGE_SIZE,
	type TaskQueueScope,
	type TaskStatusFilter,
} from "./personal-follow-ups-view";

export function PersonalFollowUps({
	scope,
	onScopeChange,
}: {
	scope: TaskQueueScope;
	onScopeChange: (scope: TaskQueueScope) => void;
}) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const workspaceUrl = useWorkspaceUrl();
	const [now, setNow] = useState<Date | null>(null);
	const [status, setStatus] = useState<TaskStatusFilter>("open");
	const [page, setPage] = useState(0);
	const [assigneeFilter, setAssigneeFilter] = useState<
		string | null | undefined
	>(undefined);
	const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
	const [feedback, setFeedback] = useState("");
	const query = useQuery(
		trpc.activities.taskQueue.queryOptions({
			scope,
			status,
			page,
			limit: TASK_PAGE_SIZE,
			window: "all",
			...(scope === "team" && assigneeFilter !== undefined
				? { assigneeId: assigneeFilter }
				: {}),
		}),
	);
	useEffect(() => {
		const updateClock = () => setNow(new Date());
		updateClock();
		const interval = window.setInterval(updateClock, 60_000);
		window.addEventListener("focus", updateClock);
		document.addEventListener("visibilitychange", updateClock);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener("focus", updateClock);
			document.removeEventListener("visibilitychange", updateClock);
		};
	}, []);
	const complete = useMutation(
		trpc.activities.complete.mutationOptions({
			onMutate: () => setFeedback(""),
			onSuccess: async (result) => {
				await cache.activity();
				setFeedback(
					result.completedAt ? "Task marked as done." : "Task reopened.",
				);
			},
		}),
	);
	const resetView = () => {
		setPage(0);
		setEditingTaskId(null);
		setFeedback("");
		complete.reset();
	};
	return (
		<>
			<FollowUpQueueView
				tasks={query.data?.rows ?? []}
				now={now}
				state={followUpLoadState(query.data?.rows, query.isError, now !== null)}
				scope={scope}
				status={status}
				page={page}
				total={query.data?.total ?? 0}
				counts={query.data?.counts}
				responsibleFiltered={scope === "team" && assigneeFilter !== undefined}
				responsibleFilter={
					scope === "team" ? (
						<TaskAssigneePicker
							filterMode
							value={assigneeFilter}
							disabled={query.isError || query.isFetching || complete.isPending}
							onChange={(value) => {
								if (query.isError || query.isFetching || complete.isPending)
									return;
								resetView();
								setAssigneeFilter(value);
							}}
						/>
					) : undefined
				}
				isFetching={query.isFetching}
				pendingId={complete.isPending ? complete.variables?.id : undefined}
				error={complete.error?.message}
				feedback={feedback}
				workspaceUrl={workspaceUrl}
				onRefresh={() => void query.refetch()}
				onScopeChange={(next) => {
					if (complete.isPending) return;
					resetView();
					onScopeChange(next);
				}}
				onStatusChange={(next) => {
					if (complete.isPending) return;
					resetView();
					setStatus(next);
				}}
				onPageChange={(next) => {
					if (complete.isPending) return;
					setEditingTaskId(null);
					setPage(next);
					setFeedback("");
					complete.reset();
				}}
				onEdit={setEditingTaskId}
				onComplete={(id, completed) => {
					const task = query.data?.rows.find((row) => row.id === id);
					if (
						task?.taskPermissions?.canEdit !== true ||
						complete.isPending ||
						query.isError ||
						query.isFetching
					)
						return;
					complete.mutate({ id, completed, expectedVersion: task.taskVersion });
				}}
			/>
			{editingTaskId && (
				<TaskEditor
					taskId={editingTaskId}
					onClose={() => setEditingTaskId(null)}
				/>
			)}
		</>
	);
}
