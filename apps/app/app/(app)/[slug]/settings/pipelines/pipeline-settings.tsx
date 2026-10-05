"use client";

import Add from "@carbon/icons-react/es/Add";
import Archive from "@carbon/icons-react/es/Archive";
import ArrowDown from "@carbon/icons-react/es/ArrowDown";
import ArrowUp from "@carbon/icons-react/es/ArrowUp";
import Checkmark from "@carbon/icons-react/es/Checkmark";
import Renew from "@carbon/icons-react/es/Renew";
import TrashCan from "@carbon/icons-react/es/TrashCan";
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
import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Checkbox } from "@crm/ui/components/checkbox";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@crm/ui/components/empty";
import { Field, FieldDescription, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@crm/ui/components/sheet";
import { Spinner } from "@crm/ui/components/spinner";
import { cn } from "@crm/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import { createPipelineCommandKeyStore } from "./pipeline-command-keys.mjs";
import {
	addStage,
	draftFromPipeline,
	moveStage,
	newPipelineDraft,
	type PipelineDraft,
	removeStage,
	toCreateMutationInput,
	toggleTransition,
	toUpdateMutationInput,
	updateStage,
	validatePipelineDraft,
} from "./pipeline-editor-model.mjs";

type ArchiveCandidate = {
	id: string;
	name: string;
	version: number;
};

export function PipelineSettings() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const [draft, setDraft] = useState<PipelineDraft | null>(null);
	const [archiveCandidate, setArchiveCandidate] =
		useState<ArchiveCandidate | null>(null);
	const commandKeysRef = useRef<ReturnType<
		typeof createPipelineCommandKeyStore
	> | null>(null);
	if (commandKeysRef.current === null) {
		commandKeysRef.current = createPipelineCommandKeyStore();
	}
	const commandKeys = commandKeysRef.current;
	const commandKey = (scope: string, fingerprint: unknown) =>
		commandKeys.get(scope, JSON.stringify(fingerprint));
	const pipelines = useQuery(
		trpc.pipelines.list.queryOptions({ includeArchived: true }),
	);
	const invalidate = () => cache.pipelines();

	const create = useMutation(
		trpc.pipelines.create.mutationOptions({
			onSuccess: async (_data, variables) => {
				commandKeys.clear("pipeline-create", variables.idempotencyKey);
				await invalidate();
				setDraft(null);
				toast.success("Pipeline created.");
			},
			onError: (error) => {
				void invalidate();
				toast.error(error.message);
			},
		}),
	);
	const update = useMutation(
		trpc.pipelines.update.mutationOptions({
			onSuccess: async (_data, variables) => {
				commandKeys.clear(
					`pipeline-update:${variables.id}`,
					variables.idempotencyKey,
				);
				await invalidate();
				setDraft(null);
				toast.success("Pipeline saved.");
			},
			onError: (error) => {
				void invalidate();
				toast.error(error.message);
			},
		}),
	);
	const setDefault = useMutation(
		trpc.pipelines.setDefault.mutationOptions({
			onSuccess: async (_data, variables) => {
				commandKeys.clear(
					`pipeline-default:${variables.id}`,
					variables.idempotencyKey,
				);
				await invalidate();
				toast.success("Default pipeline changed.");
			},
			onError: (error) => {
				void invalidate();
				toast.error(error.message);
			},
		}),
	);
	const archive = useMutation(
		trpc.pipelines.archive.mutationOptions({
			onSuccess: async (_data, variables) => {
				commandKeys.clear(
					`pipeline-archive:${variables.id}`,
					variables.idempotencyKey,
				);
				await invalidate();
				setArchiveCandidate(null);
				toast.success("Pipeline archived.");
			},
			onError: (error) => {
				void invalidate();
				toast.error(error.message);
			},
		}),
	);
	const restore = useMutation(
		trpc.pipelines.restore.mutationOptions({
			onSuccess: async (_data, variables) => {
				commandKeys.clear(
					`pipeline-restore:${variables.id}`,
					variables.idempotencyKey,
				);
				await invalidate();
				toast.success("Pipeline restored.");
			},
			onError: (error) => {
				void invalidate();
				toast.error(error.message);
			},
		}),
	);

	if (pipelines.isPending) {
		return (
			<div
				className="flex min-h-32 max-w-4xl items-center justify-center"
				aria-live="polite"
			>
				<Spinner />
				<span className="sr-only">Loading pipelines</span>
			</div>
		);
	}
	if (pipelines.isError) {
		return (
			<Empty className="max-w-4xl rounded-lg border">
				<EmptyHeader>
					<EmptyTitle>Pipelines could not be loaded</EmptyTitle>
					<EmptyDescription>{pipelines.error.message}</EmptyDescription>
				</EmptyHeader>
				<Button variant="outline" onClick={() => pipelines.refetch()}>
					Try again
				</Button>
			</Empty>
		);
	}

	const { items, canManage } = pipelines.data;
	const busy =
		create.isPending ||
		update.isPending ||
		setDefault.isPending ||
		archive.isPending ||
		restore.isPending;

	return (
		<div className="flex max-w-4xl flex-col gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Sales processes</CardTitle>
					<CardDescription>
						The default pipeline receives new deals. Archived pipelines stay
						available for historical reporting.
					</CardDescription>
					<CardAction>
						{canManage ? (
							<Button
								onClick={() => setDraft(newPipelineDraft())}
								disabled={busy}
							>
								<Add data-icon="inline-start" />
								New pipeline
							</Button>
						) : null}
					</CardAction>
				</CardHeader>
				<CardContent>
					{items.length === 0 ? (
						<Empty className="min-h-40">
							<EmptyHeader>
								<EmptyTitle>No pipelines yet</EmptyTitle>
								<EmptyDescription>
									Create the stages your team actually sells through.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<div className="divide-y rounded-md border">
							{items.map((pipeline) => (
								<div
									key={pipeline.id}
									className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
								>
									<button
										type="button"
										disabled={!canManage || busy || pipeline.isArchived}
										aria-label={
											pipeline.isArchived
												? `${pipeline.name} is archived and must be restored before editing`
												: `Edit ${pipeline.name}`
										}
										onClick={() => setDraft(draftFromPipeline(pipeline))}
										className="min-w-0 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default"
									>
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-medium">{pipeline.name}</span>
											{pipeline.isDefault ? <Badge>Default</Badge> : null}
											{pipeline.isArchived ? (
												<Badge variant="outline">Archived</Badge>
											) : null}
										</div>
										<p className="mt-1 text-xs text-muted-foreground">
											{pipeline.stages.map((stage) => stage.name).join(" → ")}
										</p>
									</button>
									{canManage ? (
										<div className="flex shrink-0 flex-wrap gap-2">
											{!pipeline.isArchived && !pipeline.isDefault ? (
												<Button
													variant="outline"
													size="sm"
													disabled={busy}
													onClick={() =>
														setDefault.mutate({
															id: pipeline.id,
															expectedVersion: pipeline.version,
															idempotencyKey: commandKey(
																`pipeline-default:${pipeline.id}`,
																{
																	id: pipeline.id,
																	version: pipeline.version,
																},
															),
														})
													}
												>
													<Checkmark data-icon="inline-start" /> Default
												</Button>
											) : null}
											{pipeline.isArchived ? (
												<Button
													variant="outline"
													size="sm"
													disabled={busy}
													onClick={() =>
														restore.mutate({
															id: pipeline.id,
															expectedVersion: pipeline.version,
															idempotencyKey: commandKey(
																`pipeline-restore:${pipeline.id}`,
																{
																	id: pipeline.id,
																	version: pipeline.version,
																},
															),
														})
													}
												>
													<Renew data-icon="inline-start" /> Restore
												</Button>
											) : !pipeline.isDefault ? (
												<Button
													variant="outline"
													size="sm"
													disabled={busy}
													onClick={() =>
														setArchiveCandidate({
															id: pipeline.id,
															name: pipeline.name,
															version: pipeline.version,
														})
													}
												>
													<Archive data-icon="inline-start" /> Archive
												</Button>
											) : null}
										</div>
									) : null}
								</div>
							))}
						</div>
					)}
					{!canManage ? (
						<p className="text-xs text-muted-foreground">
							Only an owner or admin can change pipelines.
						</p>
					) : null}
				</CardContent>
			</Card>

			<PipelineEditor
				draft={draft}
				busy={busy}
				onClose={() => setDraft(null)}
				onChange={setDraft}
				onSave={(next) => {
					const errors = validatePipelineDraft(next);
					if (errors.length > 0) {
						toast.error(errors[0]);
						return;
					}
					try {
						if (next.id === null) {
							create.mutate(
								toCreateMutationInput(
									next,
									commandKey("pipeline-create", next),
								),
							);
						} else {
							update.mutate(
								toUpdateMutationInput(
									next,
									commandKey(`pipeline-update:${next.id}`, next),
								),
							);
						}
					} catch (error) {
						toast.error(
							error instanceof Error
								? error.message
								: "Pipeline input is invalid.",
						);
					}
				}}
			/>

			<AlertDialog
				open={archiveCandidate !== null}
				onOpenChange={(open) => {
					if (!open && !archive.isPending) setArchiveCandidate(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Archive {archiveCandidate?.name ?? "pipeline"}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							The pipeline will no longer accept active deals. Historical data
							remains available and the pipeline can be restored later.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={archive.isPending}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={archive.isPending || archiveCandidate === null}
							onClick={(event) => {
								event.preventDefault();
								if (!archiveCandidate) return;
								archive.mutate({
									id: archiveCandidate.id,
									expectedVersion: archiveCandidate.version,
									idempotencyKey: commandKey(
										"pipeline-archive:" + archiveCandidate.id,
										{
											id: archiveCandidate.id,
											version: archiveCandidate.version,
										},
									),
								});
							}}
						>
							{archive.isPending ? <Spinner data-icon="inline-start" /> : null}
							Archive pipeline
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function PipelineEditor({
	draft,
	busy,
	onClose,
	onChange,
	onSave,
}: {
	draft: PipelineDraft | null;
	busy: boolean;
	onClose(): void;
	onChange(value: PipelineDraft): void;
	onSave(value: PipelineDraft): void;
}) {
	const nameId = useId();
	const slugId = useId();
	const defaultId = useId();
	const errors = useMemo(
		() => (draft ? validatePipelineDraft(draft) : []),
		[draft],
	);
	return (
		<Sheet
			open={draft !== null}
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<SheetContent
				size="2xl"
				className="overflow-hidden"
				showCloseButton={!busy}
				onEscapeKeyDown={(event) => {
					if (busy) event.preventDefault();
				}}
				onPointerDownOutside={(event) => {
					if (busy) event.preventDefault();
				}}
			>
				{draft ? (
					<>
						<SheetHeader className="border-b">
							<SheetTitle size="lg">
								{draft.id ? `Edit ${draft.name}` : "New pipeline"}
							</SheetTitle>
							<SheetDescription>
								Stage keys are stable automation identifiers. Stage order and
								transitions are validated again by the server.
							</SheetDescription>
						</SheetHeader>
						<div className="flex-1 overflow-y-auto p-4 sm:p-6">
							<div className="grid gap-4 sm:grid-cols-2">
								<Field>
									<FieldLabel htmlFor={nameId}>Name</FieldLabel>
									<Input
										id={nameId}
										value={draft.name}
										disabled={busy}
										onChange={(event) =>
											onChange({ ...draft, name: event.target.value })
										}
									/>
								</Field>
								<Field>
									<FieldLabel htmlFor={slugId}>Slug</FieldLabel>
									<Input
										id={slugId}
										value={draft.slug}
										disabled={busy}
										onChange={(event) =>
											onChange({ ...draft, slug: event.target.value })
										}
									/>
									<FieldDescription>
										Used by API clients and automation rules.
									</FieldDescription>
								</Field>
							</div>
							{draft.id === null ? (
								<Field orientation="horizontal" className="mt-4">
									<Checkbox
										id={defaultId}
										checked={draft.isDefault}
										disabled={busy}
										onCheckedChange={(value) =>
											onChange({ ...draft, isDefault: value === true })
										}
									/>
									<div>
										<FieldLabel htmlFor={defaultId}>
											Make this the default pipeline
										</FieldLabel>
										<FieldDescription>
											New deals will start in this pipeline. The first pipeline
											is always made default by the server.
										</FieldDescription>
									</div>
								</Field>
							) : null}
							<div className="mt-6 flex items-center justify-between">
								<div>
									<h3 className="text-sm font-medium">Stages</h3>
									<p className="text-xs text-muted-foreground">
										Every pipeline needs an open, won and lost stage.
									</p>
								</div>
								<Button
									variant="outline"
									size="sm"
									disabled={busy || draft.stages.length >= 200}
									onClick={() => onChange(addStage(draft))}
								>
									<Add data-icon="inline-start" /> Add stage
								</Button>
							</div>
							<div className="mt-3 flex flex-col gap-3">
								{draft.stages.map((stage, index) => (
									<StageEditor
										key={stage.id ?? `${stage.key}:${index}`}
										draft={draft}
										index={index}
										busy={busy}
										onChange={onChange}
									/>
								))}
							</div>
							{errors.length > 0 ? (
								<div
									className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
									role="alert"
								>
									<p className="font-medium">Resolve before saving</p>
									<ul className="mt-1 list-disc space-y-1 pl-4">
										{errors.slice(0, 5).map((error) => (
											<li key={error}>{error}</li>
										))}
									</ul>
								</div>
							) : null}
						</div>
						<SheetFooter className="border-t sm:flex-row sm:justify-end">
							<Button variant="outline" onClick={onClose} disabled={busy}>
								Cancel
							</Button>
							<Button
								onClick={() => onSave(draft)}
								disabled={busy || errors.length > 0}
							>
								{busy ? <Spinner data-icon="inline-start" /> : null}
								Save pipeline
							</Button>
						</SheetFooter>
					</>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

function StageEditor({
	draft,
	index,
	busy,
	onChange,
}: {
	draft: PipelineDraft;
	index: number;
	busy: boolean;
	onChange(value: PipelineDraft): void;
}) {
	const stage = draft.stages[index];
	const nameId = useId();
	const keyId = useId();
	const probabilityId = useId();
	const colorId = useId();
	const outcomeId = useId();
	if (!stage) return null;
	return (
		<div className="rounded-lg border bg-card p-4">
			<div className="flex items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2">
					<span
						className="size-2.5 shrink-0 rounded-full"
						style={{ backgroundColor: stage.color ?? "#64748B" }}
						aria-hidden="true"
					/>
					<strong className="truncate text-xs">Stage {index + 1}</strong>
				</div>
				<div className="flex gap-1">
					<Button
						variant="ghost"
						size="icon-sm"
						disabled={busy || index === 0}
						onClick={() => onChange(moveStage(draft, index, index - 1))}
					>
						<ArrowUp />
						<span className="sr-only">Move stage up</span>
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						disabled={busy || index === draft.stages.length - 1}
						onClick={() => onChange(moveStage(draft, index, index + 1))}
					>
						<ArrowDown />
						<span className="sr-only">Move stage down</span>
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						disabled={busy || draft.stages.length <= 3}
						onClick={() => onChange(removeStage(draft, index))}
					>
						<TrashCan />
						<span className="sr-only">Remove stage</span>
					</Button>
				</div>
			</div>
			<div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
				<Field>
					<FieldLabel htmlFor={nameId}>Name</FieldLabel>
					<Input
						id={nameId}
						value={stage.name}
						disabled={busy}
						onChange={(event) =>
							onChange(updateStage(draft, index, { name: event.target.value }))
						}
					/>
				</Field>
				<Field>
					<FieldLabel htmlFor={keyId}>Key</FieldLabel>
					<Input
						id={keyId}
						value={stage.key}
						disabled={busy}
						onChange={(event) =>
							onChange(updateStage(draft, index, { key: event.target.value }))
						}
					/>
				</Field>
				<Field>
					<FieldLabel htmlFor={outcomeId}>Outcome</FieldLabel>
					<Select
						value={stage.type}
						disabled={busy}
						onValueChange={(type: "OPEN" | "WON" | "LOST") =>
							onChange(updateStage(draft, index, { type }))
						}
					>
						<SelectTrigger id={outcomeId}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="OPEN">Open</SelectItem>
							<SelectItem value="WON">Won</SelectItem>
							<SelectItem value="LOST">Lost</SelectItem>
						</SelectContent>
					</Select>
				</Field>
				<Field>
					<FieldLabel htmlFor={probabilityId}>Probability</FieldLabel>
					<div className="relative">
						<Input
							id={probabilityId}
							type="number"
							min={0}
							max={stage.type === "OPEN" ? 99.99 : 100}
							step={0.01}
							value={stage.probabilityBps / 100}
							disabled={busy || stage.type !== "OPEN"}
							onChange={(event) => {
								const percentage = event.currentTarget.valueAsNumber;
								if (!Number.isFinite(percentage)) return;
								onChange(
									updateStage(draft, index, {
										probabilityBps: Math.round(percentage * 100),
									}),
								);
							}}
						/>
						<span className="pointer-events-none absolute top-2 right-2 text-muted-foreground">
							%
						</span>
					</div>
				</Field>
				<Field>
					<FieldLabel htmlFor={colorId}>Color</FieldLabel>
					<Input
						id={colorId}
						type="color"
						value={stage.color ?? "#64748B"}
						disabled={busy}
						onChange={(event) =>
							onChange(updateStage(draft, index, { color: event.target.value }))
						}
						className="h-9 p-1"
					/>
				</Field>
			</div>
			<div className="mt-3">
				<p className="mb-2 text-xs font-medium">Allowed previous stages</p>
				<p className="mb-2 text-xs text-muted-foreground">
					Leave every option unchecked to allow entry from any non-current
					stage.
				</p>
				<div className="flex flex-wrap gap-x-4 gap-y-2">
					{draft.stages
						.filter((source) => source.key !== stage.key)
						.map((source) => {
							const checked = stage.allowedFromStageKeys.includes(source.key);
							const transitionId = `${colorId}-from-${source.key}`;
							return (
								<label
									htmlFor={transitionId}
									key={source.id ?? source.key}
									className={cn(
										"flex items-center gap-2 text-xs",
										busy && "opacity-50",
									)}
								>
									<Checkbox
										id={transitionId}
										checked={checked}
										disabled={busy}
										onCheckedChange={(value) =>
											onChange(
												toggleTransition(
													draft,
													index,
													source.key,
													value === true,
												),
											)
										}
									/>
									{source.name || source.key}
								</label>
							);
						})}
				</div>
			</div>
		</div>
	);
}
