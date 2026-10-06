"use client";

import { Input } from "@crm/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@crm/ui/components/input-group";
import { Label } from "@crm/ui/components/label";
import { Spinner } from "@crm/ui/components/spinner";
import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { activityLabel } from "@/lib/activity-presentation";
import { taskCreationFields } from "@/lib/task-editor-model.mjs";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import { TaskAssigneePicker } from "../tasks/task-assignee-picker";
import { ActivityIcon } from "./activity-icon";
import type { TimelineAnchor } from "./timeline";

const TYPES = ["NOTE", "CALL", "EMAIL", "MEETING", "TASK"] as const;
type ComposableType = (typeof TYPES)[number];
const PLACEHOLDER = {
	NOTE: "Log a note, call, email, meeting or task…",
	CALL: "What came out of the call?",
	EMAIL: "What was said?",
	MEETING: "What came out of the meeting?",
	TASK: "What needs doing?",
} satisfies Record<ComposableType, string>;

export function ActivityComposer({ anchor }: { anchor: TimelineAnchor }) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const dueId = useId();
	const [type, setType] = useState<ComposableType>("NOTE");
	const [draft, setDraft] = useState("");
	const [deadline, setDeadline] = useState("");
	const [assigneeId, setAssigneeId] = useState<string | null | undefined>(
		undefined,
	);
	const [validation, setValidation] = useState("");
	const isTask = type === "TASK";
	const text = draft.trim();
	const reset = () => {
		setDraft("");
		setDeadline("");
		setAssigneeId(undefined);
		setValidation("");
	};
	const create = useMutation(
		trpc.activities.create.mutationOptions({
			onSuccess: async () => {
				await cache.activity();
				reset();
			},
		}),
	);
	const submit = () => {
		if (text === "" || create.isPending) return;
		setValidation("");
		try {
			create.mutate({
				...anchor,
				type,
				subject: isTask ? text : undefined,
				body: isTask ? undefined : text,
				...(isTask ? taskCreationFields({ deadline, assigneeId }) : {}),
			});
		} catch (error) {
			setValidation(
				error instanceof Error
					? error.message
					: "Check the due date and try again.",
			);
		}
	};
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<fieldset disabled={create.isPending} className="min-w-0 space-y-3">
				<InputGroup>
					<InputGroupTextarea
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						placeholder={PLACEHOLDER[type]}
						aria-label={isTask ? "What needs doing" : "What happened"}
						onKeyDown={(event) => {
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								submit();
							}
							if (event.key === "Escape" && !create.isPending) reset();
						}}
					/>
					<InputGroupAddon
						align="block-end"
						className="flex-wrap gap-2 border-t"
					>
						<ToggleGroup
							type="single"
							value={type}
							onValueChange={(next) => next && setType(next as ComposableType)}
							size="sm"
							spacing={0}
							aria-label="Activity type"
						>
							{TYPES.map((option) => (
								<ToggleGroupItem
									key={option}
									value={option}
									aria-label={activityLabel(option)}
								>
									<ActivityIcon type={option} />
									{activityLabel(option)}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
						{text && (
							<InputGroupButton
								type="submit"
								variant="default"
								size="xs"
								className="ml-auto"
								disabled={create.isPending}
							>
								{create.isPending ? <Spinner /> : null}
								{isTask
									? "Add task"
									: `Log ${activityLabel(type).toLowerCase()}`}
							</InputGroupButton>
						)}
					</InputGroupAddon>
				</InputGroup>
				{isTask && (
					<div className="space-y-3">
						<TaskAssigneePicker
							value={assigneeId}
							onChange={setAssigneeId}
							disabled={create.isPending}
							defaultSelf
						/>
						<div className="space-y-2">
							<Label htmlFor={dueId}>Due date and time (optional)</Label>
							<Input
								id={dueId}
								type="datetime-local"
								value={deadline}
								onChange={(event) => setDeadline(event.target.value)}
								aria-describedby={`${dueId}-help`}
							/>
							<p id={`${dueId}-help`} className="text-xs text-muted-foreground">
								Uses your device timezone and the exact time you choose. Leave
								blank for no deadline. A repeated daylight-saving hour uses its
								first occurrence.
							</p>
						</div>
					</div>
				)}
			</fieldset>
			{validation && (
				<p role="alert" className="mt-2 text-sm text-destructive">
					{validation}
				</p>
			)}
			{create.isError && (
				<p role="alert" className="mt-2 text-sm text-destructive">
					{create.error.message} Your draft is preserved; review it before
					trying again.
				</p>
			)}
		</form>
	);
}
