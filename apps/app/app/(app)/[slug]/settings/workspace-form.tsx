"use client";

import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@crm/ui/components/input-group";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceSlug } from "@/lib/use-workspace-url";
import { workspaceUrl } from "@/lib/workspace-url";

export function WorkspaceForm() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const router = useRouter();
	const slug = useWorkspaceSlug();

	const nameId = useId();
	const websiteId = useId();

	const workspace = useQuery(trpc.workspace.get.queryOptions());

	const [draft, setDraft] = useState<{ name: string; website: string } | null>(
		null,
	);

	const save = useMutation(
		trpc.workspace.update.mutationOptions({
			onSuccess: async (saved) => {
				await cache.workspace();
				setDraft(null);
				toast.success("Workspace saved.");

				if (saved.slug !== slug) {
					router.replace(workspaceUrl(saved.slug, "/settings"));
				}
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!workspace.data)
		return (
			<Card>
				<CardHeader>
					<CardTitle>Workspace</CardTitle>
					<CardDescription role={workspace.isError ? "alert" : "status"}>
						{workspace.isError
							? "Workspace settings could not be loaded."
							: "Loading workspace settings…"}
					</CardDescription>
					{workspace.isError && (
						<CardAction>
							<Button
								variant="outline"
								disabled={workspace.isFetching}
								onClick={() => void workspace.refetch()}
							>
								Try again
							</Button>
						</CardAction>
					)}
				</CardHeader>
			</Card>
		);

	const { name, website, canRename } = workspace.data;

	const values = draft ?? { name, website: website ?? "" };
	const dirty = values.name !== name || values.website !== (website ?? "");

	const edit = (patch: Partial<typeof values>) =>
		setDraft({ ...values, ...patch });

	return (
		<Card>
			<CardHeader>
				<CardTitle>Workspace</CardTitle>
				<CardDescription>
					The name and website of the company using this CRM.
				</CardDescription>

				<CardAction>
					<Button
						type="submit"
						form="workspace"
						disabled={
							!canRename ||
							save.isPending ||
							!dirty ||
							values.name.trim() === ""
						}
					>
						{save.isPending ? <Spinner data-icon="inline-start" /> : null}
						Save
					</Button>
				</CardAction>
			</CardHeader>

			<CardContent>
				<form
					id="workspace"
					onSubmit={(event) => {
						event.preventDefault();
						save.mutate({
							name: values.name,
							website: values.website.trim(),
						});
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor={nameId}>Name</FieldLabel>
							<Input
								id={nameId}
								value={values.name}
								onChange={(event) => edit({ name: event.target.value })}
								placeholder="Acme Inc."
								autoComplete="organization"
								maxLength={120}
								disabled={!canRename || save.isPending}
								required
							/>
							<FieldDescription>
								Shown wherever the CRM refers to your own company.
							</FieldDescription>
						</Field>

						<Field>
							<FieldLabel htmlFor={websiteId}>Website (optional)</FieldLabel>
							<InputGroup>
								<InputGroupAddon>
									<InputGroupText>https://</InputGroupText>
								</InputGroupAddon>
								<InputGroupInput
									id={websiteId}
									maxLength={255}
									value={values.website}
									onChange={(event) => edit({ website: event.target.value })}
									placeholder="acme.com"
									autoComplete="off"
									autoCapitalize="off"
									autoCorrect="off"
									spellCheck={false}
									inputMode="url"
									disabled={!canRename || save.isPending}
								/>
							</InputGroup>
							<FieldDescription>
								Used as company research context. Leave blank to remove it.
							</FieldDescription>
						</Field>
					</FieldGroup>
					{save.isError && (
						<p role="alert" className="mt-4 text-sm text-destructive">
							{save.error.message}
						</p>
					)}
				</form>

				{canRename ? null : (
					<p className="text-muted-foreground text-xs">
						Only an owner or an admin can change this.
					</p>
				)}
			</CardContent>
		</Card>
	);
}
