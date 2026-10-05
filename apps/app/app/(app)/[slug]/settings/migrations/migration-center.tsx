"use client";
import ArrowUpRight from "@carbon/icons-react/es/ArrowUpRight";
import Check from "@carbon/icons-react/es/Checkmark";
import ChevronRight from "@carbon/icons-react/es/ChevronRight";
import Download from "@carbon/icons-react/es/Download";
import RefreshCw from "@carbon/icons-react/es/Renew";
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
import { Empty, EmptyDescription, EmptyHeader } from "@crm/ui/components/empty";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { Skeleton } from "@crm/ui/components/skeleton";
import {
	WorkspaceMetric,
	WorkspaceMetrics,
	WorkspaceNotice,
	WorkspacePanel,
	WorkspaceToolbar,
} from "@crm/ui/components/workspace";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "api/app-router";
import { useEffect, useRef, useState } from "react";
import {
	PageShellActions,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import type { OperationsKey } from "@/lib/operations-catalog.mjs";
import { useTRPC } from "@/lib/trpc/client";
import {
	OperationsLanguage,
	useOperationsLocale,
} from "@/lib/use-operations-locale";
import { OperationStatus } from "../../operations/operation-status";
import { BackgroundImportControls } from "./background-import-controls";
import {
	canRunMigration,
	mappingEntries,
	progressOf,
	validateMappingSelection,
} from "./migration-view-model.mjs";
import { SourceMaintenance } from "./source-maintenance";

type Outputs = inferRouterOutputs<AppRouter>["migrations"];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function useMigrationCenter() {
	const trpc = useTRPC();
	const qc = useQueryClient();
	const { text: t, locale } = useOperationsLocale();
	const capabilities = useQuery(trpc.migrations.capabilities.queryOptions({}));
	const listing = useQuery({
		...trpc.migrations.list.queryOptions({}),
		enabled: capabilities.data?.configured === true,
		refetchInterval: 5000,
	});
	const [preview, setPreview] = useState<Outputs["preview"] | null>(null);
	const [entity, setEntity] = useState<"contact" | "company">("contact");
	const [fields, setFields] = useState<Record<string, string>>({});
	const [prepared, setPrepared] = useState<Outputs["prepare"] | null>(null);
	const [jobId, setJobId] = useState<string | null>(null);
	const [cursor, setCursor] = useState(0);
	const [running, setRunning] = useState(false);
	const active = useRef(false);
	const mounted = useRef(true);
	const command = useRef<string | null>(null);
	const [error, setError] = useState(false);
	const [fileError, setFileError] = useState(false);
	const [sourceLoading, setSourceLoading] = useState(false);
	const [confirm, setConfirm] = useState<"run" | "delete" | "rollback" | null>(
		null,
	);
	const [rollback, setRollback] = useState<Outputs["rollback"] | null>(null);
	const [rollbackCursor, setRollbackCursor] = useState(0);
	const upload = useMutation(trpc.migrations.upload.mutationOptions());
	const prepare = useMutation(trpc.migrations.prepare.mutationOptions());
	const execute = useMutation(trpc.migrations.executeNext.mutationOptions());
	const cancel = useMutation(trpc.migrations.cancel.mutationOptions());
	const rollbackMutation = useMutation(
		trpc.migrations.rollback.mutationOptions(),
	);
	const removeSource = useMutation(
		trpc.migrations.removeSource.mutationOptions(),
	);
	const exportReport = useMutation(
		trpc.migrations.exportReport.mutationOptions(),
	);
	const report = useQuery({
		...trpc.migrations.report.queryOptions({
			jobId: jobId ?? "none",
			afterRow: cursor,
		}),
		enabled: !!jobId,
		refetchInterval: 5000,
	});
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			active.current = false;
		};
	}, []);
	const refresh = async () => {
		await Promise.all([
			qc.invalidateQueries({ queryKey: trpc.migrations.list.queryKey() }),
			qc.invalidateQueries({ queryKey: trpc.migrations.report.queryKey() }),
		]);
	};
	const invalidatePlan = () => {
		command.current = null;
		setPrepared(null);
		setJobId(null);
		setCursor(0);
		setRollback(null);
		setRollbackCursor(0);
		setError(false);
	};
	const choose = async (sourceId: string, sha256: string) => {
		if (active.current) return;
		setError(false);
		setFileError(false);
		setSourceLoading(true);
		try {
			const next = await qc.fetchQuery(
				trpc.migrations.preview.queryOptions({
					sourceId,
					expectedSha256: sha256,
				}),
			);
			invalidatePlan();
			setPreview(next);
			setFields({});
		} catch {
			setError(true);
		} finally {
			setSourceLoading(false);
		}
	};
	const onFile = async (file: File | undefined) => {
		if (!file || active.current || upload.isPending) return;
		setError(false);
		setFileError(false);
		if (
			file.size > (capabilities.data?.maxBytes ?? 524288) ||
			!/\.(csv|tsv)$/i.test(file.name)
		) {
			setFileError(true);
			return;
		}
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			let binary = "";
			for (let i = 0; i < bytes.length; i += 32768)
				binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
			const result = await upload.mutateAsync({
				filename: file.name,
				mimeType: file.name.toLowerCase().endsWith(".tsv")
					? "text/tab-separated-values"
					: "text/csv",
				base64: btoa(binary),
			});
			if (mounted.current) {
				invalidatePlan();
				setPreview(result);
				setFields({});
				await refresh();
			}
		} catch {
			if (mounted.current) setError(true);
		}
	};
	const savePlan = async () => {
		if (!preview) return;
		setError(false);
		command.current ??= crypto.randomUUID();
		try {
			const result = await prepare.mutateAsync({
				sourceId: preview.source.id,
				expectedSha256: preview.source.sha256,
				entityType: entity,
				mapping: mappingEntries(fields),
				commandId: command.current,
			});
			setPrepared(result);
			setJobId(result.jobId);
			setCursor(0);
			await refresh();
		} catch {
			setError(true);
		}
	};
	const run = async () => {
		const id = jobId;
		if (!id || active.current) return;
		active.current = true;
		setRunning(true);
		setError(false);
		let busy = 0;
		try {
			for (let i = 0; i < 220 && active.current; i++) {
				const result = await execute.mutateAsync({ jobId: id });
				await refresh();
				if (result.done || ["FAILED", "CANCELLED"].includes(result.status))
					break;
				if (result.busy) {
					if (++busy >= 60) break;
					await wait(2000);
				} else {
					busy = 0;
					await wait(50);
				}
			}
		} catch {
			if (mounted.current) setError(true);
		} finally {
			active.current = false;
			if (mounted.current) {
				setRunning(false);
				await refresh();
				await qc.invalidateQueries({ queryKey: trpc.contacts.list.queryKey() });
				await qc.invalidateQueries({
					queryKey: trpc.companies.list.queryKey(),
				});
			}
		}
	};
	const cancelJob = async () => {
		if (!jobId) return;
		active.current = false;
		try {
			await cancel.mutateAsync({ jobId });
			await refresh();
		} catch {
			setError(true);
		}
	};
	const previewRollback = async (afterRow = 0) => {
		if (!jobId) return;
		try {
			const result = await rollbackMutation.mutateAsync({
				jobId,
				afterRow,
				apply: false,
			});
			setRollbackCursor(afterRow);
			setRollback(result);
		} catch {
			setError(true);
		}
	};
	const confirmAction = async () => {
		const action = confirm;
		setConfirm(null);
		if (action === "run") {
			await run();
			return;
		}
		try {
			if (action === "delete" && preview) {
				await removeSource.mutateAsync({
					sourceId: preview.source.id,
					expectedSha256: preview.source.sha256,
				});
				setPreview(null);
				invalidatePlan();
			}
			if (action === "rollback" && jobId) {
				await rollbackMutation.mutateAsync({
					jobId,
					afterRow: rollbackCursor,
					apply: true,
					confirmation: jobId,
				});
				await previewRollback(rollbackCursor);
			}
			await refresh();
		} catch {
			setError(true);
		}
	};
	const downloadReport = async () => {
		if (!jobId || exportReport.isPending) return;
		setError(false);
		try {
			const result = await exportReport.mutateAsync({ jobId });
			if (!mounted.current) return;
			const url = URL.createObjectURL(
				new Blob([result.content], { type: result.mimeType }),
			);
			const link = document.createElement("a");
			link.href = url;
			link.download = result.filename;
			document.body.appendChild(link);
			link.click();
			link.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch {
			if (mounted.current) setError(true);
		}
	};
	const progress = progressOf(report.data);
	const schema = capabilities.data?.fields[entity];
	const status = report.data?.status ?? prepared?.status;
	const busy =
		sourceLoading ||
		exportReport.isPending ||
		upload.isPending ||
		prepare.isPending ||
		running ||
		cancel.isPending ||
		rollbackMutation.isPending ||
		removeSource.isPending;
	const mappingReady = validateMappingSelection(schema, fields);
	const stage =
		jobId &&
		(!prepared ||
			running ||
			["IMPORTING", "COMPLETED", "FAILED", "CANCELLED"].includes(status ?? ""))
			? 3
			: prepared
				? 2
				: preview
					? 1
					: 0;
	const steps = [t.upload, t.mapping, t.review, t.importProgress];
	const stageIds = [
		"import-source",
		"import-mapping",
		"import-review",
		"import-results",
	];
	return {
		locale,
		t,
		error,
		fileError,
		capabilities,
		listing,
		report,
		busy,
		setError,
		setFileError,
		refresh,
		steps,
		stageIds,
		stage,
		jobId,
		preview,
		prepared,
		upload,
		sourceLoading,
		onFile,
		choose,
		setConfirm,
		entity,
		setEntity,
		setFields,
		invalidatePlan,
		schema,
		fields,
		mappingReady,
		savePlan,
		prepare,
		status,
		running,
		progress,
		active,
		cancel,
		cancelJob,
		exportReport,
		downloadReport,
		previewRollback,
		cursor,
		setCursor,
		rollback,
		setJobId,
		setPrepared,
		setPreview,
		setRollback,
		confirm,
		confirmAction,
	};
}

export function MigrationCenter() {
	return <MigrationWorkspace view={useMigrationCenter()} />;
}

function MigrationWorkspace({
	view,
}: {
	view: ReturnType<typeof useMigrationCenter>;
}) {
	const {
		locale,
		t,
		error,
		fileError,
		capabilities,
		listing,
		report,
		busy,
		setError,
		setFileError,
		refresh,
		steps,
		stageIds,
		stage,
		jobId,
		preview,
		prepared,
		setConfirm,
		confirm,
		confirmAction,
	} = view;
	return (
		<div className="min-w-0 space-y-6" lang={locale}>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>{t.migration}</PageShellTitle>
					<PageShellDescription>{t.intro}</PageShellDescription>
				</PageShellHeading>
				<PageShellActions>
					<OperationsLanguage />
				</PageShellActions>
			</PageShellHeader>
			{(error ||
				fileError ||
				capabilities.error ||
				listing.error ||
				report.error) && (
				<WorkspaceNotice tone="danger" role="alert">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p>{fileError ? t.sourceFileError : t.error}</p>
						<Button
							variant="outline"
							disabled={busy}
							onClick={() => {
								setError(false);
								setFileError(false);
								void capabilities.refetch();
								void refresh();
							}}
						>
							<RefreshCw aria-hidden="true" />
							{t.refresh}
						</Button>
					</div>
				</WorkspaceNotice>
			)}
			{capabilities.isPending ? (
				<div role="status" aria-label={t.loading} className="space-y-4">
					<span className="sr-only">{t.loading}</span>
					<Skeleton className="h-16" />
					<Skeleton className="h-64" />
				</div>
			) : capabilities.data && !capabilities.data.configured ? (
				<WorkspaceNotice>{t.notConfigured}</WorkspaceNotice>
			) : (
				capabilities.data && (
					<>
						{!capabilities.data.executionEnabled && (
							<WorkspaceNotice role="status">{t.readOnly}</WorkspaceNotice>
						)}
						{(!jobId || preview || prepared) && (
							<nav aria-label={t.workflow}>
								<ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
									{steps.map((label, index) => (
										<li
											key={stageIds[index]}
											className="flex min-w-0 items-center gap-3 text-sm"
										>
											<span
												className="flex size-6 shrink-0 items-center justify-center rounded-md border text-xs tabular-nums text-muted-foreground"
												aria-hidden="true"
											>
												{index < stage ? (
													<Check className="size-3" />
												) : (
													index + 1
												)}
											</span>
											{index <= stage ? (
												<a
													href={`#${stageIds[index]}`}
													aria-current={index === stage ? "step" : undefined}
													className="min-w-0 font-medium underline-offset-4 hover:underline"
												>
													{label.replace(/^\d+\.\s*/, "")}
												</a>
											) : (
												<span className="min-w-0 text-muted-foreground">
													{label.replace(/^\d+\.\s*/, "")}
												</span>
											)}
										</li>
									))}
								</ol>
							</nav>
						)}
						<div className="grid min-w-0 items-start gap-6 xl:grid-cols-3">
							<div className="min-w-0 space-y-6 xl:col-span-2">
								<MigrationSource view={view} />
								{preview && <MigrationMapping view={view} />}
								{prepared && <MigrationReview view={view} />}
								{jobId && <MigrationReport view={view} />}
							</div>
							<MigrationHistory view={view} />
						</div>
					</>
				)
			)}
			<p className="text-xs leading-relaxed text-muted-foreground">
				{t.partial}
			</p>
			<AlertDialog
				open={confirm !== null}
				onOpenChange={(open) => {
					if (!open) setConfirm(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{confirm === "run"
								? t.confirmImport
								: confirm === "delete"
									? t.deleteSource
									: t.rollback}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{confirm === "run"
								? t.confirmHelp
								: confirm === "delete"
									? t.deleteHelp
									: t.rollbackHelp}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t.back}</AlertDialogCancel>
						<AlertDialogAction
							disabled={busy}
							onClick={() => void confirmAction()}
						>
							{t.confirm}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

type MigrationView = ReturnType<typeof useMigrationCenter>;

function MigrationSource({ view }: { view: MigrationView }) {
	const {
		t,
		busy,
		onFile,
		upload,
		listing,
		preview,
		choose,
		sourceLoading,
		locale,
		jobId,
		setConfirm,
	} = view;
	return (
		<div id="import-source">
			<WorkspacePanel
				title={t.upload.replace(/^\d+\.\s*/, "")}
				description={t.uploadHelp}
			>
				<label
					htmlFor="migration-source-file"
					className="block space-y-2 text-sm"
				>
					<span>{t.selectFile}</span>
					<Input
						id="migration-source-file"
						type="file"
						accept=".csv,.tsv"
						disabled={busy}
						aria-describedby="file-help"
						onChange={(event) => {
							void onFile(event.target.files?.[0]);
							event.target.value = "";
						}}
					/>
				</label>
				<p id="file-help" className="sr-only">
					{t.uploadHelp}
				</p>
				{upload.isPending && (
					<WorkspaceNotice role="status">{t.fileBusy}</WorkspaceNotice>
				)}
				{listing.isPending && <Skeleton className="h-8" />}
				{!!listing.data?.sources.some((source) => !source.deleted) && (
					<div className="space-y-2">
						<label
							htmlFor="migration-stored-source"
							id="stored-sources-label"
							className="text-sm"
						>
							{t.storedSources}
						</label>
						<Select
							value={preview?.source.id ?? "__none"}
							disabled={busy}
							onValueChange={(value) => {
								const source = listing.data?.sources.find(
									(item) => item.id === value,
								);
								if (source) void choose(source.id, source.sha256);
							}}
						>
							<SelectTrigger
								id="migration-stored-source"
								aria-labelledby="stored-sources-label"
								className="w-full min-w-0"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="__none" disabled>
									{t.noSource}
								</SelectItem>
								{listing.data?.sources
									.filter((source) => !source.deleted)
									.map((source) => (
										<SelectItem key={source.id} value={source.id}>
											{source.filename} · {source.createdAt.slice(0, 10)}
										</SelectItem>
									))}
							</SelectContent>
						</Select>
					</div>
				)}
				{sourceLoading && (
					<p role="status" className="text-sm text-muted-foreground">
						{t.sourceLoading}
					</p>
				)}
				{preview ? (
					<WorkspaceToolbar>
						<div className="min-w-0 space-y-1">
							<p className="break-words text-sm font-medium">
								{preview.source.filename}
							</p>
							<p className="text-xs tabular-nums text-muted-foreground">
								{t.sourceRows}:{" "}
								{preview.preview.totalRows.toLocaleString(locale)}
							</p>
						</div>
						<Button
							wrap
							variant="ghost"
							disabled={busy || !!jobId}
							onClick={() => setConfirm("delete")}
						>
							{t.remove}
						</Button>
					</WorkspaceToolbar>
				) : (
					!upload.isPending &&
					!sourceLoading && (
						<p className="text-sm leading-relaxed text-muted-foreground">
							{t.sourceEmpty}
						</p>
					)
				)}
			</WorkspacePanel>
		</div>
	);
}

function MigrationMapping({ view }: { view: MigrationView }) {
	const {
		t,
		entity,
		busy,
		setEntity,
		setFields,
		invalidatePlan,
		schema,
		fields,
		preview,
		mappingReady,
		savePlan,
		prepare,
	} = view;
	if (!preview) return null;
	return (
		<div id="import-mapping">
			<WorkspacePanel
				title={t.mapping.replace(/^\d+\.\s*/, "")}
				description={t.mappingHelp}
			>
				<div className="max-w-xs space-y-2">
					<label
						htmlFor="migration-entity"
						id="migration-entity-label"
						className="text-sm"
					>
						{t.entity}
					</label>
					<Select
						value={entity}
						disabled={busy}
						onValueChange={(value) => {
							setEntity(value as "contact" | "company");
							setFields({});
							invalidatePlan();
						}}
					>
						<SelectTrigger
							id="migration-entity"
							aria-labelledby="migration-entity-label"
							className="w-full"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="contact">{t.contact}</SelectItem>
							<SelectItem value="company">{t.company}</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					{schema?.map((field) => (
						<div key={field.key} className="min-w-0 space-y-2">
							<label
								id={`mapping-${field.key}`}
								htmlFor={`mapping-select-${field.key}`}
								className="flex flex-wrap items-center gap-2 text-sm"
							>
								{t[field.key as OperationsKey] ?? field.key}
								{field.required && (
									<span className="text-xs text-muted-foreground">
										{t.required}
									</span>
								)}
							</label>
							<Select
								value={
									fields[field.key] ? `column:${fields[field.key]}` : "__skip"
								}
								disabled={busy}
								required={field.required}
								onValueChange={(value) => {
									setFields((previous) => ({
										...previous,
										[field.key]: value === "__skip" ? "" : value.slice(7),
									}));
									invalidatePlan();
								}}
							>
								<SelectTrigger
									className="w-full min-w-0"
									id={`mapping-select-${field.key}`}
									aria-labelledby={`mapping-${field.key}`}
									aria-required={field.required}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="__skip">{t.skip}</SelectItem>
									{preview.preview.headers.map((header) => (
										<SelectItem key={header} value={`column:${header}`}>
											{header}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					))}
				</div>
				<details>
					<summary className="cursor-pointer text-sm font-medium">
						{t.preview} · {preview.preview.rows.length} /{" "}
						{preview.preview.totalRows}
					</summary>
					<section
						aria-label={t.preview}
						// biome-ignore lint/a11y/noNoninteractiveTabindex: This bounded viewport must support keyboard scrolling.
						tabIndex={0}
						className="mt-3 max-h-64 overflow-auto"
					>
						<table className="w-full text-left text-xs">
							<caption className="sr-only">{t.preview}</caption>
							<thead className="sticky top-0 bg-card">
								<tr>
									<th scope="col" className="border-b p-3">
										#
									</th>
									{preview.preview.headers.map((header) => (
										<th
											scope="col"
											key={header}
											className="whitespace-nowrap border-b p-3"
										>
											{header}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{preview.preview.rows.map((row, i) => (
									<tr key={preview.preview.rowNumbers[i]} className="border-b">
										<th scope="row" className="p-3 tabular-nums">
											{preview.preview.rowNumbers[i]}
										</th>
										{row.map((cell, j) => (
											<td
												key={preview.preview.headers[j]}
												className="max-w-64 truncate p-3"
												title={cell}
											>
												{cell}
											</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
					</section>
				</details>
				<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
					<p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
						{mappingReady ? t.mappingReady : t.mappingIncomplete}
					</p>
					<Button
						wrap
						disabled={busy || !mappingReady}
						onClick={() => void savePlan()}
					>
						{prepare.isPending ? t.loading : t.prepare}
						<ChevronRight aria-hidden="true" />
					</Button>
				</div>
			</WorkspacePanel>
		</div>
	);
}

function MigrationReview({ view }: { view: MigrationView }) {
	const { t, prepared, locale } = view;
	if (!prepared) return null;
	return (
		<div id="import-review">
			<WorkspacePanel title={t.review.replace(/^\d+\.\s*/, "")}>
				<WorkspaceMetrics label={t.review}>
					<WorkspaceMetric
						label={t.sourceRows}
						value={prepared.stats.sourceRows.toLocaleString(locale)}
					/>
					<WorkspaceMetric
						label={t.validRows}
						value={prepared.stats.validRows.toLocaleString(locale)}
					/>
					<WorkspaceMetric
						label={t.invalidRows}
						value={prepared.stats.errorRows.toLocaleString(locale)}
						tone={prepared.stats.errorRows ? "warning" : "default"}
					/>
				</WorkspaceMetrics>
				<WorkspaceNotice role="status">{t.planSaved}</WorkspaceNotice>
				{!!prepared.issues.length && (
					<details>
						<summary className="cursor-pointer text-sm font-medium">
							{t.reason} ({prepared.issueCount})
						</summary>
						<ul className="mt-3 max-h-48 divide-y overflow-y-auto text-sm">
							{prepared.issues.map((issue) => (
								<li className="py-2" key={`${issue.rowNumber}-${issue.code}`}>
									{t.row} {issue.rowNumber}:{" "}
									<code className="text-xs">{issue.code}</code>
								</li>
							))}
						</ul>
					</details>
				)}
			</WorkspacePanel>
		</div>
	);
}

function MigrationReport({ view }: { view: MigrationView }) {
	const {
		report,
		t,
		status,
		jobId,
		capabilities,
		busy,
		refresh,
		progress,
		locale,
		running,
		active,
		setConfirm,
		cancel,
		cancelJob,
		downloadReport,
		exportReport,
		previewRollback,
		cursor,
		setCursor,
		rollback,
	} = view;
	if (!jobId || !capabilities.data) return null;
	const deployment = capabilities.data;
	return (
		<div id="import-results">
			<WorkspacePanel
				title={report.data?.sourceFilename ?? t.importProgress}
				action={
					status ? <OperationStatus value={status} text={t} /> : undefined
				}
			>
				<p className="break-all text-xs text-muted-foreground">ID: {jobId}</p>
				<p className="text-sm leading-relaxed text-muted-foreground">
					{report.data?.background.enabled ? t.backgroundHelp : t.jobHelp}
				</p>
				{report.isPending && (
					<div role="status" aria-label={t.loading}>
						<span className="sr-only">{t.loading}</span>
						<Skeleton className="h-24" />
					</div>
				)}
				{report.data && (
					<BackgroundImportControls
						jobId={jobId}
						allowed={deployment.backgroundEnabled}
						active={report.data.background.enabled}
						jobStatus={report.data.status}
						lastErrorCode={report.data.background.lastErrorCode}
						nextAttemptAt={report.data.background.nextAttemptAt}
						localBusy={busy}
						refresh={refresh}
					/>
				)}
				{report.data && (
					<>
						<div className="space-y-2">
							<div className="flex flex-wrap justify-between gap-2 text-sm">
								<span>{t.processedRows}</span>
								<span className="tabular-nums">
									{progress.processed.toLocaleString(locale)} /{" "}
									{progress.total.toLocaleString(locale)}
								</span>
							</div>
							<progress
								className="h-2 w-full accent-primary"
								max={progress.total || 1}
								value={progress.processed}
								aria-label={t.processedRows}
							/>
						</div>
						<dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
							{(
								[
									[t.created, report.data.created],
									[t.duplicates, report.data.duplicates],
									[t.rejected, report.data.rejected],
									[t.remaining, report.data.remaining],
									[t.rolledBack, report.data.rolledBack],
								] as const
							).map(([label, value]) => (
								<div key={label}>
									<dt className="text-xs leading-relaxed text-muted-foreground">
										{label}
									</dt>
									<dd className="mt-1 text-lg font-medium tabular-nums">
										{value.toLocaleString(locale)}
									</dd>
								</div>
							))}
						</dl>
						<WorkspaceNotice
							tone={report.data.reconciliation.ok ? "info" : "warning"}
							role="status"
						>
							{report.data.reconciliation.ok ? t.reconciled : t.notReconciled}
						</WorkspaceNotice>
					</>
				)}
				<div className="flex flex-wrap gap-2 border-t pt-4">
					{running ? (
						<Button
							wrap
							variant="outline"
							onClick={() => {
								active.current = false;
							}}
						>
							{t.stop}
						</Button>
					) : (
						<Button
							disabled={
								report.data?.background.enabled ||
								!canRunMigration({
									configured: deployment.configured,
									executionEnabled: deployment.executionEnabled,
									status,
									running,
								}) ||
								busy
							}
							onClick={() => setConfirm("run")}
						>
							{t.run}
						</Button>
					)}
					{["READY", "IMPORTING"].includes(status ?? "") && (
						<Button
							variant="outline"
							disabled={cancel.isPending}
							onClick={() => void cancelJob()}
						>
							{t.cancel}
						</Button>
					)}
					<Button
						variant="ghost"
						disabled={report.isFetching}
						onClick={() => void refresh()}
					>
						<RefreshCw aria-hidden="true" />
						{t.refresh}
					</Button>
				</div>
				{report.data &&
					["COMPLETED", "FAILED", "CANCELLED"].includes(report.data.status) && (
						<div className="space-y-3">
							<div className="flex flex-wrap gap-2">
								<Button
									wrap
									variant="outline"
									disabled={busy}
									onClick={() => void downloadReport()}
								>
									<Download aria-hidden="true" />
									{exportReport.isPending ? t.loading : t.exportReport}
								</Button>
								<Button
									wrap
									variant="ghost"
									disabled={busy}
									onClick={() => void previewRollback()}
								>
									{t.rollback}
								</Button>
							</div>
							<p className="text-xs leading-relaxed text-muted-foreground">
								{t.exportReportHelp}
							</p>
						</div>
					)}
				{report.data && (
					<>
						<section
							aria-label={t.report}
							// biome-ignore lint/a11y/noNoninteractiveTabindex: This bounded viewport must support keyboard scrolling.
							tabIndex={0}
							className="overflow-x-auto"
						>
							<table className="w-full text-left text-sm">
								<caption className="sr-only">{t.report}</caption>
								<thead>
									<tr>
										{[t.row, t.outcome, t.reason].map((label) => (
											<th
												key={label}
												scope="col"
												className="border-b px-3 py-3 text-xs font-medium text-muted-foreground"
											>
												{label}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{report.data.rows.map((row) => (
										<tr key={row.rowNumber} className="border-b last:border-0">
											<th
												scope="row"
												className="px-3 py-3 font-normal tabular-nums"
											>
												{row.rowNumber}
											</th>
											<td className="px-3 py-3">
												<OperationStatus value={row.status} text={t} />
											</td>
											<td className="break-words px-3 py-3 text-xs text-muted-foreground">
												{row.code}
											</td>
										</tr>
									))}
									{!report.data.rows.length && (
										<tr>
											<td
												colSpan={3}
												className="p-4 text-sm text-muted-foreground"
											>
												{t.noRows}
											</td>
										</tr>
									)}
								</tbody>
							</table>
						</section>
						<nav
							aria-label={t.report}
							className="flex flex-wrap justify-end gap-2"
						>
							<Button
								variant="outline"
								disabled={!cursor || report.isFetching}
								onClick={() => setCursor(0)}
							>
								{t.first}
							</Button>
							<Button
								variant="outline"
								disabled={
									report.data.nextAfterRow === null || report.isFetching
								}
								onClick={() => setCursor(report.data?.nextAfterRow ?? 0)}
							>
								{t.next}
							</Button>
						</nav>
					</>
				)}
				{rollback && (
					<div className="space-y-3 border-t pt-4">
						<h3 className="text-sm font-medium">{t.rollback}</h3>
						<p className="text-xs leading-relaxed text-muted-foreground">
							{t.rollbackHelp}
						</p>
						<ul className="max-h-48 divide-y overflow-y-auto text-sm">
							{rollback.rows.map((row) => (
								<li key={row.rowNumber} className="py-2">
									{t.row} {row.rowNumber}:{" "}
									<code className="text-xs">{row.result}</code>
								</li>
							))}
						</ul>
						<div className="flex flex-wrap gap-2">
							<Button
								wrap
								variant="outline"
								disabled={
									busy ||
									!deployment.executionEnabled ||
									!rollback.rows.some((row) => row.result === "CAN_ARCHIVE")
								}
								onClick={() => setConfirm("rollback")}
							>
								{t.applyRollback}
							</Button>
							<Button
								variant="ghost"
								disabled={busy || rollback.nextAfterRow === null}
								onClick={() => void previewRollback(rollback.nextAfterRow ?? 0)}
							>
								{t.next}
							</Button>
						</div>
					</div>
				)}
			</WorkspacePanel>
		</div>
	);
}

function MigrationHistory({ view }: { view: MigrationView }) {
	const {
		t,
		listing,
		locale,
		jobId,
		busy,
		setJobId,
		setPrepared,
		setPreview,
		setCursor,
		setRollback,
		setError,
		refresh,
	} = view;
	return (
		<aside className="min-w-0 space-y-6" aria-label={t.history}>
			<WorkspacePanel title={t.history} description={t.historyHelp}>
				{listing.isPending ? (
					<div role="status" aria-label={t.loading}>
						<span className="sr-only">{t.loading}</span>
						<Skeleton className="h-32" />
					</div>
				) : listing.isError ? (
					<WorkspaceNotice tone="danger">{t.error}</WorkspaceNotice>
				) : !listing.data?.jobs.length ? (
					<Empty>
						<EmptyHeader>
							<EmptyDescription>{t.noJobs}</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<ul className="divide-y">
						{listing.data.jobs.map((job) => (
							<li key={job.id} className="space-y-3 py-4">
								<div className="min-w-0 space-y-2">
									<p className="break-words text-sm font-medium">
										{job.sourceFilename}
									</p>
									<OperationStatus value={job.status} text={t} />
									<p className="text-xs text-muted-foreground">
										<time dateTime={job.createdAt}>
											{new Intl.DateTimeFormat(locale, {
												dateStyle: "medium",
											}).format(new Date(job.createdAt))}
										</time>
									</p>
								</div>
								<Button
									variant={jobId === job.id ? "secondary" : "outline"}
									size="sm"
									disabled={busy}
									aria-pressed={jobId === job.id}
									onClick={() => {
										setJobId(job.id);
										setPrepared(null);
										setPreview(null);
										setCursor(0);
										setRollback(null);
										setError(false);
									}}
								>
									{t.report}
									<ArrowUpRight aria-hidden="true" />
								</Button>
							</li>
						))}
					</ul>
				)}
			</WorkspacePanel>
			<SourceMaintenance
				sources={listing.data?.sources ?? []}
				refresh={refresh}
			/>
		</aside>
	);
}
