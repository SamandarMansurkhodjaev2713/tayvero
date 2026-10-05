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
import { WorkspaceNotice, WorkspaceStatus } from "@crm/ui/components/workspace";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc/client";
import { useOperationsLocale } from "@/lib/use-operations-locale";
export function BackgroundImportControls({
	jobId,
	allowed,
	active,
	jobStatus,
	lastErrorCode,
	nextAttemptAt,
	localBusy,
	refresh,
}: {
	jobId: string;
	allowed: boolean;
	active: boolean;
	jobStatus: string;
	lastErrorCode: string | null;
	nextAttemptAt: string | null;
	localBusy: boolean;
	refresh: () => Promise<void>;
}) {
	const { text: t, locale } = useOperationsLocale(),
		trpc = useTRPC();
	const change = useMutation(trpc.migrations.setBackground.mutationOptions());
	const [confirm, setConfirm] = useState(false),
		[error, setError] = useState(false);
	async function save(enabled: boolean) {
		setConfirm(false);
		setError(false);
		try {
			await change.mutateAsync({
				jobId,
				enabled,
				confirmation: enabled ? jobId : undefined,
			});
			await refresh();
		} catch {
			setError(true);
		}
	}
	return (
		<div className="space-y-3 border-y py-4" aria-busy={change.isPending}>
			<h3 className="text-sm font-medium">{t.backgroundTitle}</h3>
			<WorkspaceStatus tone="neutral">
				{active ? t.backgroundQueued : t.backgroundLocal}
			</WorkspaceStatus>
			<p className="text-xs leading-relaxed text-muted-foreground">
				{t.backgroundHelp}
			</p>
			{active && nextAttemptAt && (
				<p className="text-xs text-muted-foreground">
					{t.backgroundNext}:{" "}
					<time dateTime={nextAttemptAt}>
						{new Date(nextAttemptAt).toLocaleString(locale)}
					</time>
				</p>
			)}
			{lastErrorCode && (
				<WorkspaceNotice tone="warning" role="status">
					{t.backgroundError}{" "}
					<code className="break-all text-xs">{lastErrorCode}</code>
				</WorkspaceNotice>
			)}
			{error && (
				<WorkspaceNotice tone="danger" role="alert">
					{t.error}
				</WorkspaceNotice>
			)}
			{active ? (
				<Button
					wrap
					variant="outline"
					disabled={change.isPending}
					onClick={() => void save(false)}
				>
					{t.backgroundPause}
				</Button>
			) : (
				allowed &&
				["READY", "IMPORTING"].includes(jobStatus) && (
					<Button
						wrap
						variant="outline"
						disabled={localBusy || change.isPending}
						onClick={() => setConfirm(true)}
					>
						{t.backgroundStart}
					</Button>
				)
			)}
			<AlertDialog open={confirm} onOpenChange={setConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t.backgroundStart}</AlertDialogTitle>
						<AlertDialogDescription>
							{t.backgroundConfirm}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t.back}</AlertDialogCancel>
						<AlertDialogAction
							disabled={change.isPending}
							onClick={() => void save(true)}
						>
							{t.confirm}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
