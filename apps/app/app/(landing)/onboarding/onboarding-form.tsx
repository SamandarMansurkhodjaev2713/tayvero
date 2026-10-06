"use client";

import { MAX_SLUG, workspaceSlug } from "@crm/db/workspace";
import { Button } from "@crm/ui/components/button";
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
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { useTRPC } from "@/lib/trpc/client";

export function OnboardingForm({ placeholder }: { placeholder: string }) {
	const trpc = useTRPC();
	const router = useRouter();

	const nameId = useId();
	const slugId = useId();
	const websiteId = useId();
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const slugEdited = useRef(false);

	const save = useMutation(
		trpc.workspace.update.mutationOptions({
			onSuccess: () => {
				router.refresh();
				router.replace("/");
			},
		}),
	);

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();

				const form = new FormData(event.currentTarget);

				save.mutate({
					name: String(form.get("name") ?? "").trim(),
					slug: workspaceSlug(String(form.get("slug") ?? "")),
					website: String(form.get("website") ?? "").trim(),
				});
			}}
			className="flex flex-col gap-6"
		>
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor={nameId}>Company name</FieldLabel>
					<Input
						id={nameId}
						name="name"
						value={name}
						onChange={(event) => {
							const next = event.target.value;
							setName(next);
							if (!slugEdited.current) setSlug(workspaceSlug(next));
						}}
						placeholder={placeholder}
						autoComplete="organization"
						maxLength={120}
						disabled={save.isPending}
						autoFocus
						required
					/>
				</Field>

				<Field>
					<FieldLabel htmlFor={slugId}>Workspace URL</FieldLabel>
					<InputGroup>
						<InputGroupAddon>
							<InputGroupText>/</InputGroupText>
						</InputGroupAddon>
						<InputGroupInput
							id={slugId}
							name="slug"
							maxLength={MAX_SLUG}
							disabled={save.isPending}
							value={slug}
							onChange={(event) => {
								slugEdited.current = true;
								setSlug(workspaceSlugDraft(event.target.value));
							}}
							onBlur={() =>
								setSlug((value) => (value ? workspaceSlug(value) : ""))
							}
							placeholder={workspaceSlug(placeholder)}
							autoComplete="off"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							required
						/>
					</InputGroup>
					<FieldDescription>
						Your team will use this address to open the CRM.
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
							name="website"
							maxLength={255}
							disabled={save.isPending}
							placeholder="acme.com"
							autoComplete="off"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							inputMode="url"
						/>
					</InputGroup>
					<FieldDescription>
						Add it to give company research more context. You can start without
						a website and add one in settings later.
					</FieldDescription>
				</Field>
			</FieldGroup>
			{save.isError && (
				<p role="alert" className="text-sm text-destructive">
					{save.error.message}
				</p>
			)}

			<Button type="submit" disabled={save.isPending}>
				{save.isPending ? <Spinner data-icon="inline-start" /> : null}
				Open workspace
			</Button>
		</form>
	);
}

function workspaceSlugDraft(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+/, "");
}
