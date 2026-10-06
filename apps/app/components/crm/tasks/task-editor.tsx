"use client";

import { Button } from "@crm/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@crm/ui/components/dialog";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { Skeleton } from "@crm/ui/components/skeleton";
import { WorkspaceNotice } from "@crm/ui/components/workspace";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { taskDeadlineInput, taskEditPatch } from "@/lib/task-editor-model.mjs";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { TaskAssigneePicker } from "./task-assignee-picker";
import { TaskHistory } from "./task-history";

type Task = RouterOutputs["activities"]["taskById"];
export function TaskEditor({
	taskId,
	onClose,
}: {
	taskId: string;
	onClose: () => void;
}) {
	const trpc = useTRPC();
	const [pending, setPending] = useState(false);
	const task = useQuery(trpc.activities.taskById.queryOptions({ id: taskId }));
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<DialogContent
				className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
				showCloseButton={!pending}
				onEscapeKeyDown={(event) => {
					if (pending) event.preventDefault();
				}}
				onInteractOutside={(event) => {
					if (pending) event.preventDefault();
				}}
			>
				<DialogHeader>
					<DialogTitle>Task details</DialogTitle>
					<DialogDescription>
						Review responsibility, deadline and recorded changes.
					</DialogDescription>
				</DialogHeader>
				{task.isPending && (
					<div role="status" aria-label="Loading task details">
						<Skeleton className="h-32 w-full" />
					</div>
				)}
				{task.isError && (
					<WorkspaceNotice role="alert" tone="warning">
						<p>
							Task details could not refresh. Changes are disabled until a
							current version is loaded.
						</p>
						<Button
							variant="outline"
							className="mt-2"
							disabled={task.isFetching}
							onClick={() => void task.refetch()}
						>
							Refresh task
						</Button>
					</WorkspaceNotice>
				)}
				{task.data && (
					<TaskEditorForm
						key={task.data.id}
						task={task.data}
						stale={task.isError || task.isFetching}
						onClose={onClose}
						onPending={setPending}
						onReload={async () => {
							const result = await task.refetch();
							return result.isError ? null : (result.data ?? null);
						}}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

export function TaskEditorForm({
	task,
	stale,
	onClose,
	onPending,
	onReload,
}: {
	task: Task;
	stale: boolean;
	onClose: () => void;
	onPending: (pending: boolean) => void;
	onReload: () => Promise<Task | null>;
}) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const dueId = useId();
	const [draftTask, setDraftTask] = useState(task);
	const [assigneeId, setAssigneeId] = useState<string | null>(
		task.assignee?.id ?? null,
	);
	const [deadline, setDeadline] = useState(() => taskDeadlineInput(task.dueAt));
	const [validation, setValidation] = useState("");
	const update = useMutation(
		trpc.activities.updateTask.mutationOptions({
			onMutate: () => onPending(true),
			onSuccess: async () => {
				await cache.activity();
				onClose();
			},
			onSettled: () => onPending(false),
		}),
	);
	let changed = false;
	try {
		changed =
			Object.keys(taskEditPatch({ assigneeId, deadline }, draftTask)).length >
			0;
	} catch {
		changed = true;
	}
	const canEdit = task.taskPermissions?.canEdit === true;
	const canReassign = task.taskPermissions?.canReassign === true;
	const versionChanged = task.taskVersion !== draftTask.taskVersion;
	const blocked = stale || update.isPending || update.isError || versionChanged;
	const reload = async () => {
		const current = await onReload();
		if (!current) return;
		setDraftTask(current);
		setAssigneeId(current.assignee?.id ?? null);
		setDeadline(taskDeadlineInput(current.dueAt));
		setValidation("");
		update.reset();
	};
	return (
		<div className="space-y-5">
			<div className="space-y-1">
				<p className="wrap-anywhere font-medium">
					{task.subject || "Untitled task"}
				</p>
				<p className="text-xs text-muted-foreground">
					Created by {task.createdBy.name} · editing version{" "}
					{draftTask.taskVersion}
					{task.completedAt ? " · completed" : ""}
				</p>
			</div>
			{versionChanged && (
				<TaskVersionNotice
					disabled={stale || update.isPending}
					onReload={() => void reload()}
				/>
			)}
			{task.assigneeActive === false && (
				<WorkspaceNotice tone="warning">
					The responsible person is no longer an active workspace member. The
					creator or an administrator can reassign this task.
				</WorkspaceNotice>
			)}
			<form
				className="space-y-4"
				onSubmit={(event) => {
					event.preventDefault();
					if (!canEdit || blocked) return;
					setValidation("");
					try {
						const patch = taskEditPatch({ assigneeId, deadline }, draftTask);
						if (Object.keys(patch).length > 0)
							update.mutate({
								id: task.id,
								expectedVersion: draftTask.taskVersion,
								...patch,
							});
					} catch (error) {
						setValidation(
							error instanceof Error
								? error.message
								: "Check the deadline and try again.",
						);
					}
				}}
			>
				<TaskAssigneePicker
					value={assigneeId}
					current={draftTask.assignee}
					disabled={!canReassign || blocked}
					onChange={(value) => setAssigneeId(value ?? null)}
				/>
				{!canReassign && (
					<p className="text-xs text-muted-foreground">
						Only the creator or a workspace administrator can change
						responsibility.
					</p>
				)}
				<div className="space-y-2">
					<Label htmlFor={dueId}>Due date and time</Label>
					<Input
						id={dueId}
						type="datetime-local"
						value={deadline}
						disabled={!canEdit || blocked}
						onChange={(event) => setDeadline(event.target.value)}
						aria-describedby={`${dueId}-help`}
					/>
					<p id={`${dueId}-help`} className="text-xs text-muted-foreground">
						Uses your device timezone. Clear the field to remove the deadline.
						During a repeated daylight-saving hour, a changed time uses the
						first occurrence; an unchanged deadline keeps its exact instant.
					</p>
					{deadline && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={!canEdit || blocked}
							onClick={() => setDeadline("")}
						>
							Remove deadline
						</Button>
					)}
				</div>
				{!canEdit && (
					<WorkspaceNotice>
						You can read this task and its history. Only the creator,
						responsible person or a workspace administrator can edit it.
					</WorkspaceNotice>
				)}
				{validation && (
					<p role="alert" className="text-sm text-destructive">
						{validation}
					</p>
				)}
				{update.isError && (
					<WorkspaceNotice role="alert" tone="danger">
						<p>{update.error.message} Your unsaved values are still here.</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="mt-2"
							disabled={stale || update.isPending}
							onClick={() => void reload()}
						>
							Reload current task (discards unsaved values)
						</Button>
					</WorkspaceNotice>
				)}
				<div className="flex flex-wrap justify-end gap-2">
					<Button
						type="button"
						variant="outline"
						disabled={update.isPending}
						onClick={onClose}
					>
						Close
					</Button>
					{canEdit && (
						<Button type="submit" disabled={!changed || blocked}>
							{update.isPending ? "Saving…" : "Save task changes"}
						</Button>
					)}
				</div>
			</form>
			<TaskHistory task={task} />
		</div>
	);
}

export function TaskVersionNotice({
	disabled,
	onReload,
}: {
	disabled: boolean;
	onReload: () => void;
}) {
	return (
		<WorkspaceNotice role="status" tone="warning">
			This task changed while you were editing. Your unsaved values are
			preserved. Reload the current task before saving.
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="mt-2"
				disabled={disabled}
				onClick={onReload}
			>
				Reload current task (discards unsaved values)
			</Button>
		</WorkspaceNotice>
	);
}
