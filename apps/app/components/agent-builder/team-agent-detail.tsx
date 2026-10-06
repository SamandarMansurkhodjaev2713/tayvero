"use client";

import OverflowMenuVertical from "@carbon/icons-react/es/OverflowMenuVertical";
import Pause from "@carbon/icons-react/es/Pause";
import Play from "@carbon/icons-react/es/Play";
import TrashCan from "@carbon/icons-react/es/TrashCan";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@crm/ui/components/alert-dialog";
import {
	AsyncButtonContent,
	useAsyncAction,
} from "@crm/ui/components/async-action";
import { Button } from "@crm/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import { Icon } from "@crm/ui/components/icon";
import { SaveBarViewport } from "@crm/ui/components/save-bar";
import { WorkspaceNotice, WorkspacePanel } from "@crm/ui/components/workspace";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { LocalDateTime } from "@/components/local-date-time";
import {
	PageShell,
	PageShellActions,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellTitle,
} from "@/components/page-shell";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";
import { AgentCapabilities } from "./agent-capabilities";
import { AgentCode } from "./agent-code";
import { AgentRunsDrawer } from "./agent-runs-drawer";

type AgentDetail = RouterOutputs["agents"]["byId"];
type ReviewVersion = AgentDetail["reviewVersion"];
type Runs = RouterOutputs["agents"]["history"];
type Activity = RouterOutputs["agents"]["activity"];
const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	second: "2-digit",
	timeZoneName: "short",
};

export function TeamAgentDetail({
	agentId,
	initialAgent,
	initialRuns,
	initialActivity,
}: {
	agentId: string;
	initialAgent: AgentDetail;
	initialRuns: Runs;
	initialActivity: Activity;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const workspaceUrl = useWorkspaceUrl();
	const linkedRunId = useSearchParams().get("run") || undefined;
	const [runsOpen, setRunsOpen] = useState(!!linkedRunId);
	const [selectedRunId, setSelectedRunId] = useState<string | undefined>(
		linkedRunId,
	);
	const agent = useQuery({
		...trpc.agents.byId.queryOptions({ id: agentId }),
		initialData: initialAgent,
	});
	const runs = useQuery({
		...trpc.agents.history.queryOptions({ id: agentId, limit: 50 }),
		initialData: initialRuns,
		refetchInterval: (query) =>
			query.state.data?.some((run) =>
				["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL"].includes(run.status),
			)
				? 2500
				: false,
	});
	const activity = useQuery({
		...trpc.agents.activity.queryOptions({ id: agentId, limit: 100 }),
		initialData: initialActivity,
	});
	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.agents.byId.pathKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.agents.list.pathKey() }),
			queryClient.invalidateQueries({
				queryKey: trpc.agents.activity.pathKey(),
			}),
			queryClient.invalidateQueries({
				queryKey: trpc.agents.history.pathKey(),
			}),
		]);
	const runNow = useMutation(
		trpc.agents.runNow.mutationOptions({
			onSuccess: async (result) => {
				await invalidate();
				setSelectedRunId(result.id);
				setRunsOpen(true);
				toast.success("Agent run queued.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const pause = useMutation(
		trpc.agents.pause.mutationOptions({
			onSuccess: invalidate,
			onError: (error) => toast.error(error.message),
		}),
	);
	const resume = useMutation(
		trpc.agents.resume.mutationOptions({
			onSuccess: invalidate,
			onError: (error) => toast.error(error.message),
		}),
	);
	const retryRun = useMutation(
		trpc.agents.retryRun.mutationOptions({
			onSuccess: async (result) => {
				await invalidate();
				setSelectedRunId(result.id);
				setRunsOpen(true);
				toast.success("A new run was queued using the original version.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const cancelRun = useMutation(
		trpc.agents.cancelRun.mutationOptions({
			onSuccess: async (result) => {
				await invalidate();
				toast.success(
					result.cancelled ? "Run stopped." : "That run had already finished.",
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const runAction = useAsyncAction({
		action: () =>
			runNow.mutateAsync({
				id: agentId,
				clientRequestId: crypto.randomUUID(),
			}),
	});
	const pauseAction = useAsyncAction({
		action: () => pause.mutateAsync({ id: agentId }),
	});
	const resumeAction = useAsyncAction({
		action: () => resume.mutateAsync({ id: agentId }),
	});

	if (agent.isError) {
		return (
			<PageShell>
				<PageShellHeader>
					<PageShellHeading>
						<PageShellTitle>Agent unavailable</PageShellTitle>
						<PageShellDescription>{agent.error.message}</PageShellDescription>
					</PageShellHeading>
				</PageShellHeader>
				<PageShellContent>
					<div className="flex flex-wrap gap-2">
						<Button onClick={() => void agent.refetch()} variant="outline">
							Try loading again
						</Button>
						<Button asChild variant="outline">
							<Link href={workspaceUrl("/agents")}>Back to agents</Link>
						</Button>
					</div>
				</PageShellContent>
			</PageShell>
		);
	}

	const data = agent.data ?? initialAgent;
	const isDraft = data.status === "DRAFT";
	const reviewManifest = data.reviewVersion?.manifest;
	const fallbackDescription = data.description ?? "A durable team automation.";
	const displayedName = isDraft
		? textOf(reviewManifest?.name, data.name)
		: data.name;
	const displayedDescription = isDraft
		? textOf(reviewManifest?.description, fallbackDescription)
		: fallbackDescription;
	const displayedVersionNumber =
		data.currentVersion?.number ?? data.reviewVersion?.number;
	const enabledTriggers = data.triggers.filter((trigger) => trigger.enabled);
	const canRunManually =
		enabledTriggers.length === 0 ||
		enabledTriggers.some((trigger) => trigger.type !== "EVENT");
	const nextRun =
		enabledTriggers.length === 1 ? enabledTriggers[0]?.nextRunAt : null;
	const triggerSummary =
		enabledTriggers.map((trigger) => trigger.name).join(" · ") || "Manual only";
	const activeRun = runs.data?.find((run) =>
		["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL"].includes(run.status),
	);
	const latestRun = runs.data?.[0];

	return (
		<PageShell className="min-h-0" contained>
			<PageShellHeader className="[&>div]:grid-cols-1 sm:[&>div]:grid-cols-[minmax(0,1fr)_auto]">
				<PageShellHeading>
					<PageShellTitle className="wrap-break-word">
						{displayedName}
					</PageShellTitle>
					<PageShellDescription className="wrap-break-word leading-6">
						<span className="block">{displayedDescription}</span>
						<span className="mt-2 block text-xs">
							Created by {data.createdBy.name} ·{" "}
							{isDraft ? "Private draft" : "Team agent"} · Version{" "}
							{displayedVersionNumber ?? "—"}
						</span>
					</PageShellDescription>
				</PageShellHeading>
				<PageShellActions className="col-start-1 row-start-3 justify-self-start sm:col-start-2 sm:row-start-1 sm:justify-self-end">
					<div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
						<span className="text-muted-foreground text-xs">
							{isDraft ? "Visibility" : "Trigger"}
						</span>
						<span className="text-sm">
							{isDraft ? (
								"Private draft"
							) : nextRun ? (
								<LocalDateTime date={nextRun} options={DATE_OPTIONS} />
							) : (
								triggerSummary
							)}
						</span>
						<div className="mt-1 flex flex-wrap gap-2">
							<Button
								onClick={() => {
									setSelectedRunId(undefined);
									setRunsOpen(true);
								}}
								variant="outline"
							>
								Runs
								<span className="font-mono text-muted-foreground">
									{data.runCount}
								</span>
							</Button>
							{isDraft && data.canManage ? (
								<DraftAgentActions
									agentId={data.id}
									name={displayedName}
									version={data.reviewVersion}
								/>
							) : canRunManually ? (
								<Button
									variant="outline"
									disabled={
										data.status !== "LIVE" || runAction.pending || !!activeRun
									}
									aria-busy={runAction.pending}
									onClick={() => runAction.run()}
								>
									<AsyncButtonContent
										status={runAction.status}
										pendingLabel="Queueing"
										successLabel="Queued"
										errorLabel="Try again"
									>
										<Icon icon={Play} data-icon="inline-start" />
										Run now
									</AsyncButtonContent>
								</Button>
							) : null}
							{!isDraft && data.canManage && data.status === "LIVE" ? (
								<Button
									variant="outline"
									disabled={pauseAction.pending}
									aria-busy={pauseAction.pending}
									onClick={() => pauseAction.run()}
								>
									<AsyncButtonContent
										status={pauseAction.status}
										pendingLabel="Pausing"
										successLabel="Paused"
										errorLabel="Try again"
									>
										<Icon icon={Pause} data-icon="inline-start" />
										Pause
									</AsyncButtonContent>
								</Button>
							) : null}
							{!isDraft && data.canManage && data.status === "PAUSED" ? (
								<Button
									variant="outline"
									disabled={resumeAction.pending}
									aria-busy={resumeAction.pending}
									onClick={() => resumeAction.run()}
								>
									<AsyncButtonContent
										status={resumeAction.status}
										pendingLabel="Resuming"
										successLabel="Resumed"
										errorLabel="Try again"
									>
										<Icon icon={Play} data-icon="inline-start" />
										Resume
									</AsyncButtonContent>
								</Button>
							) : null}
							{!isDraft && data.canManage ? (
								<DeleteAgentAction agentId={data.id} name={data.name} />
							) : null}
						</div>
					</div>
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1 flex flex-col gap-6">
					<AgentReadiness
						agent={data}
						activeRun={activeRun}
						onViewRun={(runId) => {
							setSelectedRunId(runId);
							setRunsOpen(true);
						}}
					/>
					{!isDraft && latestRun ? (
						<WorkspacePanel
							title="Latest run"
							description={`${latestRun.status.toLowerCase().replaceAll("_", " ")} · version ${latestRun.version.number}`}
							action={
								<Button
									variant="outline"
									onClick={() => {
										setSelectedRunId(latestRun.id);
										setRunsOpen(true);
									}}
								>
									View result and actions
								</Button>
							}
						>
							<p className="whitespace-pre-wrap wrap-break-word text-sm leading-6">
								{latestRun.summary?.trim() ||
									"No written report was recorded. Open the run to inspect its recorded actions and outcome."}
							</p>
							<p className="text-xs text-muted-foreground">
								This report is generated by the agent. Inspect the recorded
								actions to check the result.
							</p>
						</WorkspacePanel>
					) : null}
					{runs.isError ? (
						<WorkspaceNotice tone="warning">
							Run history could not refresh. The latest result may be out of
							date.{" "}
							<Button
								size="sm"
								variant="outline"
								onClick={() => void runs.refetch()}
							>
								Refresh runs
							</Button>
						</WorkspaceNotice>
					) : null}
					<AgentOverview agent={data} />
				</div>
			</PageShellContent>

			<AgentRunsDrawer
				selectedRunId={selectedRunId}
				runsError={runs.isError ? runs.error.message : undefined}
				activityError={activity.isError ? activity.error.message : undefined}
				onRefresh={() => {
					void runs.refetch();
					void activity.refetch();
				}}
				activity={activity.data ?? []}
				agentId={agentId}
				cancelling={cancelRun.isPending}
				onCancel={(runId) => cancelRun.mutate({ id: agentId, runId })}
				onOpenChange={setRunsOpen}
				onRetry={(runId) =>
					retryRun.mutate({
						id: agentId,
						runId,
						clientRequestId: crypto.randomUUID(),
					})
				}
				open={runsOpen}
				retryingRunId={
					retryRun.isPending ? retryRun.variables?.runId : undefined
				}
				runs={runs.data ?? []}
			/>
		</PageShell>
	);
}

function AgentReadiness({
	agent,
	activeRun,
	onViewRun,
}: {
	agent: AgentDetail;
	activeRun?: Runs[number];
	onViewRun: (runId: string) => void;
}) {
	const isDraft = agent.status === "DRAFT";
	let title = "This agent is not active";
	let description = "Manual runs require an active, deployed version.";
	if (isDraft) {
		title =
			agent.reviewVersion?.status === "READY"
				? "Review before activation"
				: "Finish the private draft";
		description =
			"Check the task, data access, actions and trigger. To change a draft, return to its builder conversation.";
	} else if (activeRun) {
		title =
			activeRun.status === "WAITING_FOR_APPROVAL"
				? "Waiting for an authorized reviewer"
				: "A run is already in progress";
		description =
			"Open the current run to see recorded actions. Another run cannot start while this one is active.";
	} else if (agent.status === "PAUSED") {
		title = "This agent is paused";
		description = "Resume the agent to enable its triggers and manual runs.";
	} else if (agent.status === "LIVE") {
		title =
			agent.runCount === 0 ? "Ready for its first run" : "Active for the team";
		description =
			"Activation enables its configured triggers. Run now queues real work within the current version's boundaries; review the result in Runs.";
	}
	return (
		<WorkspacePanel
			title={title}
			description={description}
			action={
				activeRun ? (
					<Button
						variant="outline"
						wrap
						onClick={() => onViewRun(activeRun.id)}
					>
						View current run
					</Button>
				) : undefined
			}
		>
			<p className="text-sm text-muted-foreground">
				Created by {agent.createdBy.name}.{" "}
				{agent.canManage
					? "You can manage this agent's settings."
					: "You can view this agent. Settings are managed by its creator or a workspace administrator."}
			</p>
			{isDraft && agent.reviewVersion?.status !== "READY" ? (
				<WorkspaceNotice>
					The builder has not marked this draft ready for activation. Continue
					its conversation and resolve the remaining questions.
				</WorkspaceNotice>
			) : null}
		</WorkspacePanel>
	);
}

function DraftAgentActions({
	agentId,
	name,
	version,
}: {
	agentId: string;
	name: string;
	version: ReviewVersion;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const workspaceUrl = useWorkspaceUrl();
	const deployable = version?.status === "READY";
	const [reviewedVersion, setReviewedVersion] =
		useState<NonNullable<ReviewVersion> | null>(null);
	const deploy = useMutation(
		trpc.agents.deploy.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.agents.byId.pathKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.agents.list.pathKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.agents.activity.pathKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.agents.files.pathKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.conversations.builderById.pathKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.conversations.builderList.pathKey(),
					}),
				]);
				toast.success("Agent deployed to the team.");
				setReviewedVersion(null);
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const deployAction = useAsyncAction({
		action: async () => {
			if (reviewedVersion?.status !== "READY") return;
			await deploy.mutateAsync({
				id: agentId,
				versionId: reviewedVersion.id,
				clientRequestId: crypto.randomUUID(),
			});
		},
	});

	return (
		<>
			{version?.sourceConversationId ? (
				<Button variant="outline" asChild>
					<Link
						href={workspaceUrl(`/chat/${version.sourceConversationId}`)}
						transitionTypes={["nav-back"]}
					>
						Change details
					</Link>
				</Button>
			) : null}
			<Button
				disabled={!deployable || deployAction.pending}
				aria-busy={deployAction.pending}
				onClick={() => {
					if (version && deployable) setReviewedVersion(version);
				}}
			>
				<AsyncButtonContent
					status={deployAction.status}
					pendingLabel="Deploying"
					successLabel="Deployed"
					errorLabel="Try again"
				>
					Review and activate
				</AsyncButtonContent>
			</Button>
			<AlertDialog
				open={reviewedVersion !== null}
				onOpenChange={(open) => {
					if (!open && !deployAction.pending) setReviewedVersion(null);
				}}
			>
				<AlertDialogContent className="max-h-[85dvh] overflow-y-auto">
					<AlertDialogHeader>
						<AlertDialogTitle>Activate {name} for the team?</AlertDialogTitle>
						<AlertDialogDescription>
							Version {reviewedVersion?.number} becomes the active version and
							its configured triggers are enabled immediately. Runs may perform
							real actions within its configured boundaries. Review the data
							access, destinations and actions before continuing.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{reviewedVersion ? (
						<dl className="space-y-3 rounded-lg border p-3 text-sm">
							<div>
								<dt className="text-muted-foreground">Task</dt>
								<dd className="mt-1 wrap-break-word">
									{reviewedVersion.manifest.description ||
										reviewedVersion.manifest.name ||
										name}
								</dd>
							</div>
							<div>
								<dt className="text-muted-foreground">Runs when</dt>
								<dd className="mt-1 wrap-break-word">
									{reviewedVersion.manifest.triggers
										.map((trigger) => trigger.summary || trigger.type)
										.filter(Boolean)
										.join(" · ") ||
										"Not specified in the draft summary. Check its trigger details before activating."}
								</dd>
							</div>
							<div>
								<dt className="text-muted-foreground">Data scope</dt>
								<dd className="mt-1 wrap-break-word">
									{reviewedVersion.manifest.dataScope.summary ||
										"Not described in the draft summary. Check its data access before activating."}
								</dd>
							</div>
						</dl>
					) : null}
					{deploy.isError ? (
						<p role="alert" className="text-sm text-destructive">
							{deploy.error.message} Activation was not confirmed. Review the
							current agent state before trying again.
						</p>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deployAction.pending}>
							Keep as draft
						</AlertDialogCancel>
						<Button
							disabled={deployAction.pending || !reviewedVersion}
							aria-busy={deployAction.pending}
							onClick={() => deployAction.run()}
						>
							<AsyncButtonContent
								status={deployAction.status}
								pendingLabel="Activating"
								successLabel="Activated"
								errorLabel="Try again"
							>
								Activate agent
							</AsyncButtonContent>
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<DeleteAgentAction agentId={agentId} name={name} />
		</>
	);
}

function DeleteAgentAction({
	agentId,
	name,
}: {
	agentId: string;
	name: string;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const router = useRouter();
	const workspaceUrl = useWorkspaceUrl();
	const [confirming, setConfirming] = useState(false);
	const remove = useMutation(
		trpc.agents.remove.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.agents.list.pathKey(),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.agents.byId.pathKey(),
						refetchType: "none",
					}),
				]);
				setConfirming(false);
				toast.success(`${name} was deleted.`);
				router.replace(workspaceUrl("/agents"));
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const removeAction = useAsyncAction({
		action: () => remove.mutateAsync({ id: agentId }),
	});

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						disabled={removeAction.pending}
					>
						<Icon icon={OverflowMenuVertical} />
						<span className="sr-only">More agent actions</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						variant="destructive"
						onSelect={() => setConfirming(true)}
					>
						<Icon icon={TrashCan} />
						Delete agent
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<AlertDialog
				open={confirming}
				onOpenChange={(open) => {
					if (!removeAction.pending) setConfirming(open);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {name}?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes it from the team agent list, disables its triggers,
							and cancels queued runs. Its run and action history stays in the
							audit log. A run already in progress may finish.
						</AlertDialogDescription>
					</AlertDialogHeader>

					<AlertDialogFooter>
						<AlertDialogCancel disabled={removeAction.pending}>
							Cancel
						</AlertDialogCancel>
						<Button
							variant="destructive"
							disabled={removeAction.pending}
							aria-busy={removeAction.pending}
							onClick={() => removeAction.run()}
						>
							<AsyncButtonContent
								status={removeAction.status}
								pendingLabel="Deleting"
								successLabel="Deleted"
								errorLabel="Try again"
							>
								Delete agent
							</AsyncButtonContent>
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function AgentOverview({ agent }: { agent: AgentDetail }) {
	const { capabilities } = agent;
	const deployed = agent.currentVersion !== null;
	const canEdit = agent.canManage && deployed;

	if (!capabilities) {
		return (
			<p className="text-muted-foreground text-sm">
				This agent has no deployed version yet.
			</p>
		);
	}

	return (
		<SaveBarViewport>
			<div className="flex flex-col gap-9">
				{deployed ? null : (
					<WorkspaceNotice>
						This is a read-only preview of your private draft. Use Change
						details to return to the builder and adjust it before activation.
					</WorkspaceNotice>
				)}
				<AgentCapabilities
					agentId={agent.id}
					canManage={canEdit}
					capabilities={capabilities}
				/>
				{deployed ? (
					<details className="rounded-lg border p-4">
						<summary className="cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
							Advanced: instructions and files
						</summary>
						<div className="mt-5">
							<WorkspaceNotice>
								File changes publish a new active version. Review changes
								carefully; use the run history to see which version performed
								each action.
							</WorkspaceNotice>
							<div className="mt-5">
								<AgentCode agentId={agent.id} canManage={canEdit} />
							</div>
						</div>
					</details>
				) : null}
			</div>
		</SaveBarViewport>
	);
}

function textOf(value: string | undefined, fallback: string): string {
	return value?.trim() ? value : fallback;
}
