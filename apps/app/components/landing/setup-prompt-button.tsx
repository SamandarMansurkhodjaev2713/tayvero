"use client";

import Checkmark from "@carbon/icons-react/es/Checkmark";
import Copy from "@carbon/icons-react/es/Copy";
import { Button } from "@crm/ui/components/button";
import { Textarea } from "@crm/ui/components/textarea";
import { useEffect, useRef, useState } from "react";
import { type CtaLocation, captureLanding } from "./analytics";
import { REPO_URL } from "./links";

const SETUP_PROMPT = `Помоги запустить Tayvero из ${REPO_URL}. Прочитай README.md и docs/setup.md. Сначала создай и настрой локальный .env из .env.example, затем установи зависимости Bun 1.3.12, запусти локальный PostgreSQL, примени миграции и запусти приложение. Объясни, какие ключи OAuth и агентных провайдеров ещё нужны. Не используй production-базу, не публикуй секреты и не включай write/continuation/background flags до проверок.`;

export function SetupPromptButton({ location }: { location: CtaLocation }) {
	const [copied, setCopied] = useState(false);
	const [copyError, setCopyError] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	async function copy() {
		try {
			await navigator.clipboard.writeText(SETUP_PROMPT);
			captureLanding("setup_prompt_copied", location);
			setCopyError(false);
			setCopied(true);
			if (timer.current) clearTimeout(timer.current);
			timer.current = setTimeout(() => setCopied(false), 2500);
		} catch {
			setCopyError(true);
			setCopied(false);
		}
	}

	return (
		<div className="tayvero-landing-setup-action">
			<Button
				variant="outline"
				size="xl"
				wrap
				onClick={copy}
				aria-label="Скопировать промпт для локального запуска"
			>
				{copied ? (
					<Checkmark aria-hidden="true" data-icon="inline-start" />
				) : (
					<Copy aria-hidden="true" data-icon="inline-start" />
				)}
				{copied ? "Промпт скопирован" : "Промпт для запуска"}
			</Button>
			<span className="sr-only" role="status" aria-live="polite">
				{copied ? "Промпт скопирован в буфер обмена" : ""}
			</span>
			{copyError ? (
				<div className="tayvero-landing-copy-fallback">
					<p role="status">
						Буфер обмена недоступен. Скопируйте промпт из поля:
					</p>
					<Textarea
						readOnly
						aria-label="Промпт для запуска Tayvero"
						value={SETUP_PROMPT}
						onFocus={(event) => event.currentTarget.select()}
					/>
				</div>
			) : null}
		</div>
	);
}
