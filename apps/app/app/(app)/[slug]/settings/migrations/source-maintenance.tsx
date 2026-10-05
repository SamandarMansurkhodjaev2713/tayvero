"use client";
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
import { WorkspaceNotice, WorkspacePanel } from "@crm/ui/components/workspace";
import { useMutation } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/app-router";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc/client";
import { useOperationsLocale } from "@/lib/use-operations-locale";

type Outputs = inferRouterOutputs<AppRouter>["migrations"];
export function SourceMaintenance({
	sources,
	refresh,
}: {
	sources: Outputs["list"]["sources"];
	refresh: () => Promise<void>;
}) {
	const { text: t } = useOperationsLocale(),
		trpc = useTRPC();
	const [plan, setPlan] = useState<Outputs["cleanupSources"] | null>(null),
		[confirm, setConfirm] = useState(false),
		[error, setError] = useState(false);
	const cleanup = useMutation(trpc.migrations.cleanupSources.mutationOptions()),
		remove = useMutation(trpc.migrations.removeSource.mutationOptions());
	const busy = cleanup.isPending || remove.isPending;
	async function review() {
		setError(false);
		try {
			setPlan(await cleanup.mutateAsync({ apply: false }));
		} catch {
			setError(true);
		}
	}
	async function apply() {
		if (!plan || plan.applied) return;
		setConfirm(false);
		setError(false);
		try {
			setPlan(
				await cleanup.mutateAsync({
					cutoff: plan.cutoff,
					apply: true,
					expectedPlanHash: plan.planHash,
				}),
			);
			await refresh();
		} catch {
			setPlan(null);
			setError(true);
		}
	}
	async function retry(source: Outputs["list"]["sources"][number]) {
		setError(false);
		try {
			await remove.mutateAsync({
				sourceId: source.id,
				expectedSha256: source.sha256,
			});
			await refresh();
			setPlan(null);
		} catch {
			setError(true);
		}
	}
	return (
		<WorkspacePanel
			title={t.sourceMaintenance}
			description={t.sourceMaintenanceHelp}
		>
			<div className="space-y-4" aria-busy={busy}>
				{sources
					.filter((s) => s.deleted && !s.purged)
					.map((s) => (
						<div
							key={s.id}
							className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b pb-3"
						>
							<span className="min-w-0 break-words text-sm">{s.filename}</span>
							<Button
								wrap
								variant="outline"
								size="sm"
								disabled={busy}
								onClick={() => void retry(s)}
							>
								{t.cleanupPending}
							</Button>
						</div>
					))}
				<Button
					wrap
					variant="outline"
					disabled={busy}
					onClick={() => void review()}
				>
					{busy ? t.loading : t.cleanupPreview}
				</Button>
				{error && (
					<WorkspaceNotice tone="danger" role="alert">
						{t.error}
					</WorkspaceNotice>
				)}
				{plan && (
					<div className="space-y-3 text-sm">
						<p>
							{t.cleanupProtected}: {plan.protectedCount}
						</p>
						{plan.truncated && (
							<WorkspaceNotice tone="warning" role="status">
								{t.cleanupPartial}
							</WorkspaceNotice>
						)}
						{!!plan.warnings.length && (
							<WorkspaceNotice tone="warning" role="status">
								{t.reviewRequired}: {plan.warnings.join(", ")}
							</WorkspaceNotice>
						)}
						{!plan.candidates.length ? (
							<p>{t.cleanupEmpty}</p>
						) : (
							<ul className="max-h-60 divide-y overflow-y-auto">
								{plan.candidates.map((c) => (
									<li
										key={c.sourceId}
										className="flex flex-wrap justify-between gap-2 py-3"
									>
										<span className="break-all">
											{sources.find((s) => s.id === c.sourceId)?.filename ??
												c.sourceId}
										</span>
										<span className="text-xs text-muted-foreground">
											{c.kind === "PENDING_PURGE"
												? t.sourcePendingPurge
												: c.kind === "UNUSED_EXPIRED"
													? t.sourceUnusedExpired
													: t.sourceOrphan}
										</span>
									</li>
								))}
							</ul>
						)}
						{!plan.applied && !!plan.candidates.length && (
							<Button
								wrap
								variant="destructive"
								disabled={busy}
								onClick={() => setConfirm(true)}
							>
								{t.cleanupApply}
							</Button>
						)}
						{plan.applied && (
							<div role="status" aria-live="polite">
								<h3 className="font-medium">{t.cleanupResults}</h3>
								<ul>
									{plan.results.map((r) => (
										<li key={r.sourceId} className="break-all">
											{r.sourceId}:{" "}
											{r.status === "PURGED" ? t.purged : t.reviewRequired}
											{r.code ? ` · ${r.code}` : ""}
										</li>
									))}
								</ul>
							</div>
						)}
					</div>
				)}
			</div>
			<AlertDialog open={confirm} onOpenChange={setConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t.cleanupApply}</AlertDialogTitle>
						<AlertDialogDescription>{t.cleanupConfirm}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t.back}</AlertDialogCancel>
						<AlertDialogAction disabled={busy} onClick={() => void apply()}>
							{t.confirm}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</WorkspacePanel>
	);
}
