"use client";
import RefreshCw from "@carbon/icons-react/es/Renew";
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
	WorkspaceNotice,
	WorkspacePanel,
	WorkspaceToolbar,
} from "@crm/ui/components/workspace";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { OperationsKey } from "@/lib/operations-catalog.mjs";
import { useTRPC } from "@/lib/trpc/client";
import { useOperationsLocale } from "@/lib/use-operations-locale";
import { OperationStatus } from "./operation-status";

const states: Record<string, OperationsKey> = {
	PREPARED: "continuationPrepared",
	BOUND: "continuationBound",
	READY: "continuationReady",
	DISPATCHING: "continuationDispatching",
	DELIVERED: "continuationDelivered",
	COMPLETED: "continuationCompleted",
	RECONCILIATION_REQUIRED: "continuationAttention",
	CANCELLED: "cancelled",
};
export function ContinuationsPanel({
	enabled,
	active,
}: {
	enabled: boolean;
	active: boolean;
}) {
	const trpc = useTRPC();
	const { locale, text: t } = useOperationsLocale();
	const [status, setStatus] = useState<"ACTIVE" | "ATTENTION" | "ALL">(
		"ACTIVE",
	);
	const [before, setBefore] = useState<{
		id: string;
		createdAt: string;
	} | null>(null);
	const query = useQuery({
		...trpc.operations.continuations.queryOptions({ status, before }),
		enabled: enabled && active,
		refetchInterval: 15000,
	});
	const stateLabel = (value: string) => {
		const key = states[value];
		return key ? t[key] : value;
	};
	const stamp = (value: string | null) =>
		value ? (
			<time dateTime={value}>
				{new Intl.DateTimeFormat(locale, {
					dateStyle: "medium",
					timeStyle: "short",
				}).format(new Date(value))}
			</time>
		) : (
			t.unknown
		);
	if (!enabled)
		return <WorkspaceNotice>{t.continuationDisabled}</WorkspaceNotice>;
	return (
		<section className="space-y-4" aria-label={t.continuations}>
			<p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
				{t.continuationHelp}
			</p>
			<WorkspaceToolbar>
				<div className="flex flex-wrap items-center gap-3">
					<span
						id="continuation-filter-label"
						className="text-sm text-muted-foreground"
					>
						{t.status}
					</span>
					<Select
						value={status}
						onValueChange={(value) => {
							setStatus(value as typeof status);
							setBefore(null);
						}}
					>
						<SelectTrigger aria-labelledby="continuation-filter-label">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="ACTIVE">{t.continuationActive}</SelectItem>
							<SelectItem value="ATTENTION">
								{t.continuationAttention}
							</SelectItem>
							<SelectItem value="ALL">{t.all}</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<Button
					variant="outline"
					disabled={query.isFetching}
					onClick={() => void query.refetch()}
				>
					<RefreshCw aria-hidden="true" />
					{t.refresh}
				</Button>
			</WorkspaceToolbar>
			{query.isError ? (
				<WorkspaceNotice tone="danger" role="alert">
					{t.operationsError}
				</WorkspaceNotice>
			) : query.isPending ? (
				<div role="status" aria-label={t.loading}>
					<span className="sr-only">{t.loading}</span>
					<Skeleton className="h-48" />
				</div>
			) : query.data.items.length === 0 ? (
				<WorkspacePanel title={t.continuations}>
					<Empty>
						<EmptyHeader>
							<EmptyDescription>{t.continuationEmpty}</EmptyDescription>
						</EmptyHeader>
						{status !== "ALL" && (
							<Button
								variant="outline"
								onClick={() => {
									setStatus("ALL");
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
					{query.data.items.map((row) => (
						<WorkspacePanel
							key={row.id}
							title={row.toolName}
							action={
								<OperationStatus
									value={row.status}
									text={t}
									label={stateLabel(row.status)}
								/>
							}
						>
							<dl className="grid gap-4 text-sm sm:grid-cols-2">
								<div>
									<dt className="text-xs text-muted-foreground">
										{t.continuationWaitingAt}
									</dt>
									<dd className="mt-1">{stamp(row.waitingAt)}</dd>
								</div>
								<div>
									<dt className="text-xs text-muted-foreground">
										{t.continuationDeliveredAt}
									</dt>
									<dd className="mt-1">{stamp(row.deliveredAt)}</dd>
								</div>
							</dl>
							{row.status === "RECONCILIATION_REQUIRED" && (
								<WorkspaceNotice tone="warning" role="status">
									{t.continuationSafety}
								</WorkspaceNotice>
							)}
							{row.errorCode && (
								<p className="break-all font-mono text-xs text-muted-foreground">
									{row.errorCode}
								</p>
							)}
							<details className="border-t pt-3 text-xs text-muted-foreground">
								<summary className="cursor-pointer">{t.evidence}</summary>
								<dl className="mt-3 space-y-2">
									<div>
										<dt>{t.runId}</dt>
										<dd className="break-all">{row.runId}</dd>
									</div>
									<div>
										<dt>{t.approvals}</dt>
										<dd className="break-all">{row.approvalId}</dd>
									</div>
									<div>
										<dt>ID</dt>
										<dd className="break-all">
											{row.id} · {row.callId}
										</dd>
									</div>
									<div>
										<dt>{t.lastSnapshot}</dt>
										<dd>{stamp(row.updatedAt)}</dd>
									</div>
								</dl>
							</details>
						</WorkspacePanel>
					))}
				</div>
			)}
			<nav
				aria-label={t.continuations}
				className="flex flex-wrap justify-end gap-2"
			>
				<Button
					variant="outline"
					disabled={!before || query.isFetching}
					onClick={() => setBefore(null)}
				>
					{t.first}
				</Button>
				<Button
					variant="outline"
					disabled={!query.data?.next || query.isFetching || query.isError}
					onClick={() => setBefore(query.data?.next ?? null)}
				>
					{t.next}
				</Button>
			</nav>
		</section>
	);
}
