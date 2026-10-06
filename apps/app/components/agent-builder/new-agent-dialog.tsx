"use client";

import Checkmark from "@carbon/icons-react/es/Checkmark";
import { Button } from "@crm/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@crm/ui/components/dialog";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { Textarea } from "@crm/ui/components/textarea";
import { InvalidInput, type Permission, parse, schemas } from "@crm/validation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSlackChannels } from "@/components/slack/use-slack-channels";
import { handoffBrief, handoffResources } from "@/lib/agent-handoff";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";

export function NewAgentDialog({ children }: { children: React.ReactNode }) {
	const router = useRouter();
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const workspaceUrl = useWorkspaceUrl();

	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [job, setJob] = useState("");
	const [channelId, setChannelId] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [allowed, setAllowed] = useState<Permission[]>(
		schemas.agents.defaultPermissions,
	);

	const channels = useSlackChannels({ enabled: open });
	const rows = channels.channels;
	const channel = rows.find((row) => row.id === channelId);

	const create = useMutation(
		trpc.conversations.createBuilder.mutationOptions({
			onSuccess: async ({ id }) => {
				await queryClient.invalidateQueries({
					queryKey: trpc.conversations.builderList.pathKey(),
				});
				setOpen(false);
				router.push(workspaceUrl(`/chat/${id}`));
			},
			onError: (error) => setFormError(error.message),
		}),
	);

	const ready = name.trim().length > 0 && job.trim().length > 0;

	const hand = () => {
		if (!ready || create.isPending) return;
		setFormError(null);
		try {
			const handoff = parse(
				schemas.agents.handoff,
				{
					name,
					job,
					channel: channel
						? {
								id: channel.id,
								name: channel.name,
								isMember: channel.isMember,
							}
						: null,
					allowed,
				},
				"This agent",
			);

			create.mutate({
				clientRequestId: crypto.randomUUID(),
				commandType: "CREATE_AGENT",
				message: handoffBrief(handoff),
				resources: handoffResources(handoff),
				attachments: [],
			});
		} catch (error) {
			setFormError(
				error instanceof InvalidInput
					? error.message
					: "Could not prepare the draft. Your details are still here; try again.",
			);
		}
	};

	return (
		<Dialog
			onOpenChange={(next) => {
				if (!create.isPending) setOpen(next);
			}}
			open={open}
		>
			<DialogTrigger asChild>{children}</DialogTrigger>

			<DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-(--container-sheet)">
				<DialogHeader>
					<DialogTitle>Give your agent a task</DialogTitle>
					<DialogDescription>
						Describe the work and the result you need. Next, the builder
						prepares a private draft for you to review before activation.
					</DialogDescription>
				</DialogHeader>

				<form
					className="flex flex-col gap-5"
					onSubmit={(event) => {
						event.preventDefault();
						hand();
					}}
				>
					<fieldset
						disabled={create.isPending}
						className="flex min-w-0 flex-col gap-4"
					>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="agent-name">Name</Label>
							<Input
								id="agent-name"
								required
								maxLength={120}
								onChange={(event) => setName(event.target.value)}
								placeholder="Renewal prep brief"
								value={name}
							/>
						</div>

						<div className="flex flex-col gap-1.5">
							<Label htmlFor="agent-job">Task and expected result</Label>
							<Textarea
								id="agent-job"
								required
								maxLength={20_000}
								aria-describedby="agent-job-help"
								onChange={(event) => setJob(event.target.value)}
								placeholder="Find deals with no recent activity, explain why each needs attention, and prepare next steps for the deal owner."
								rows={3}
								value={job}
							/>
							<p
								id="agent-job-help"
								className="text-muted-foreground text-xs leading-5"
							>
								Include when it should act, which records it needs, and how you
								will check the result.
							</p>
						</div>

						<details className="rounded-lg border p-4">
							<summary className="cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
								Slack preferences (optional)
							</summary>
							<div className="mt-4 flex flex-col gap-4">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="agent-channel">Slack destination</Label>
									<Select
										onValueChange={(value) =>
											setChannelId(value === "__none__" ? "" : value)
										}
										value={channelId || "__none__"}
									>
										<SelectTrigger id="agent-channel">
											<SelectValue placeholder="Pick a Slack channel" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="__none__">
												Choose later in the builder
											</SelectItem>
											{rows.map((row) => (
												<SelectItem key={row.id} value={row.id}>
													#{row.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<p className="text-muted-foreground text-xs">
										{channel
											? channel.isMember
												? `CRM is already in #${channel.name}.`
												: `CRM is not in #${channel.name}. Review channel access with the builder before activation.`
											: "A Slack channel is not required to prepare a draft."}
									</p>
									{channels.pending || channels.syncing || channels.stalled ? (
										<p role="status" className="text-xs text-muted-foreground">
											{channels.stalled
												? "Channel sync needs attention. Refresh, or continue without a destination."
												: "Reading Slack channels. You can continue without a destination."}
										</p>
									) : null}
									{!channels.pending &&
									!channels.syncing &&
									rows.length === 0 ? (
										<p className="text-xs text-muted-foreground leading-5">
											No channels are available in this list. Refresh to check
											again, or continue without a Slack destination.
										</p>
									) : null}
									<div className="flex flex-wrap gap-2">
										<Button
											type="button"
											size="sm"
											variant="ghost"
											onClick={() => void channels.reload()}
										>
											Refresh channels
										</Button>
										{channels.hasMore ? (
											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={channels.fetchingMore}
												onClick={channels.loadMore}
											>
												{channels.fetchingMore
													? "Loading…"
													: "Load more channels"}
											</Button>
										) : null}
									</div>
								</div>

								<fieldset className="flex min-w-0 flex-col gap-1.5">
									<legend className="mb-1.5 text-sm font-medium">
										Requested Slack actions
									</legend>
									<p className="text-muted-foreground text-xs leading-5">
										These preferences guide the draft. Workspace permissions and
										approval rules still apply.
									</p>
									<div className="flex flex-wrap gap-2">
										{schemas.agents.permissions.map((entry) => {
											const on = allowed.includes(entry.id);

											return (
												<Button
													aria-pressed={on}
													key={entry.id}
													onClick={() =>
														setAllowed((current) =>
															on
																? current.filter((id) => id !== entry.id)
																: [...current, entry.id],
														)
													}
													size="sm"
													type="button"
													variant={on ? "secondary" : "outline"}
												>
													{on ? (
														<Icon
															className="size-3.5 text-primary"
															icon={Checkmark}
															motion="none"
														/>
													) : null}
													{entry.label}
												</Button>
											);
										})}
									</div>
								</fieldset>
							</div>
						</details>
					</fieldset>
					{formError ? (
						<p
							role="alert"
							className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
						>
							{formError} Your details are preserved. Review them and try again.
						</p>
					) : null}

					<DialogFooter className="items-center">
						<p className="mr-auto text-muted-foreground text-xs">
							This step opens a private planning chat.
						</p>
						<Button
							disabled={create.isPending}
							onClick={() => setOpen(false)}
							variant="outline"
							type="button"
						>
							Cancel
						</Button>
						<Button
							type="submit"
							aria-busy={create.isPending}
							disabled={!ready || create.isPending}
						>
							{create.isPending ? "Preparing…" : "Prepare private draft"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
