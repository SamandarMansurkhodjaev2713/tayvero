"use client";

import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTRPC } from "@/lib/trpc/client";

type Assignee = { id: string; name: string } | null;
export function TaskAssigneePicker({
	value,
	onChange,
	current,
	disabled = false,
	defaultSelf = false,
	filterMode = false,
}: {
	value: string | null | undefined;
	onChange: (value: string | null | undefined) => void;
	current?: Assignee;
	disabled?: boolean;
	defaultSelf?: boolean;
	filterMode?: boolean;
}) {
	const trpc = useTRPC();
	const id = useId();
	const [query, setQuery] = useState("");
	const [picked, setPicked] = useState<Assignee>(current ?? null);
	const members = useQuery({
		...trpc.workspace.members.queryOptions({ q: query, page: 1, pageSize: 25 }),
		enabled: !disabled,
	});
	const rows = members.data?.rows ?? [];
	const selected =
		value ??
		(value === undefined && filterMode
			? "__all__"
			: value === undefined && defaultSelf
				? "__self__"
				: "__none__");
	const selectedName =
		rows.find((row) => row.userId === value)?.name ??
		(picked && picked.id === value
			? picked.name
			: current && current.id === value
				? current.name
				: undefined);
	const missingSelected =
		typeof value === "string" && !rows.some((row) => row.userId === value);
	return (
		<div className="min-w-0 space-y-2">
			<Label htmlFor={id}>
				{filterMode ? "Filter by responsible person" : "Responsible person"}
			</Label>
			<Select
				value={selected}
				onValueChange={(next) => {
					const row = rows.find((member) => member.userId === next);
					if (row) setPicked({ id: row.userId, name: row.name });
					onChange(
						next === "__self__" || next === "__all__"
							? undefined
							: next === "__none__"
								? null
								: next,
					);
				}}
				disabled={disabled || members.isError}
			>
				<SelectTrigger id={id} className="w-full">
					<SelectValue>
						{value === undefined && filterMode
							? "All responsible people"
							: value === undefined && defaultSelf
								? "Me (default)"
								: value === null || value === undefined
									? "Unassigned"
									: selectedName || "Selected member"}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{filterMode && (
						<SelectItem value="__all__">All responsible people</SelectItem>
					)}
					<SelectItem value="__none__">Unassigned</SelectItem>
					{defaultSelf && (
						<SelectItem value="__self__">Me (default)</SelectItem>
					)}
					{missingSelected && (
						<SelectItem value={value}>
							{selectedName || "Selected member"} (selected)
						</SelectItem>
					)}
					{rows.map((row) => (
						<SelectItem key={row.userId} value={row.userId}>
							{row.name}
							{row.isViewer ? " (me)" : ""}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{!disabled && (
				<Input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					aria-label="Find a responsible person by name or email"
					placeholder="Find by name or email"
					maxLength={120}
				/>
			)}
			{disabled ? (
				<p className="text-xs text-muted-foreground">
					{filterMode
						? "The current filter is preserved while the queue refreshes or changes are pending."
						: "Current task responsibility."}
				</p>
			) : members.isPending ? (
				<p role="status" className="text-xs text-muted-foreground">
					Loading active members… You can keep the current selection.
				</p>
			) : members.isError ? (
				<div role="alert" className="space-y-2 text-xs text-destructive">
					<p>
						Members could not refresh. Keep the current person or try loading
						again.
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void members.refetch()}
						disabled={members.isFetching}
					>
						Refresh members
					</Button>
				</div>
			) : members.data && members.data.total > rows.length ? (
				<p className="text-xs text-muted-foreground">
					Showing the first {rows.length} of {members.data.total} matching
					active members. Search to find another person.
				</p>
			) : (
				<p className="text-xs text-muted-foreground">
					Only active workspace members can receive a task.
				</p>
			)}
		</div>
	);
}
