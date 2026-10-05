"use client";

import { Button } from "@crm/ui/components/button";
import { DetailSheetSection } from "@/components/detail-sheet";
import type { RouterOutputs } from "@/lib/trpc/types";

type Health = RouterOutputs["deals"]["byId"]["health"];

export function DealHealthPanel({
	health,
	onReviewActivity,
}: {
	health: Health;
	onReviewActivity: () => void;
}) {
	if (!health || health.status === "NOT_APPLICABLE") return null;
	const title =
		health.status === "CLEAR"
			? "No configured attention signals"
			: health.status === "INSUFFICIENT_DATA"
				? "Some facts need checking"
				: "Needs review";
	return (
		<DetailSheetSection title="Attention signals">
			<div
				data-slot="deal-health"
				className="mx-5 mb-4 rounded-lg border bg-card p-4 text-sm"
			>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h3 className="font-medium">{title}</h3>
						<p className="mt-1 text-xs text-muted-foreground">
							Based on recorded CRM data, not a prediction of winning.
						</p>
					</div>
					{health.attentionScore !== null && health.attentionScore > 0 ? (
						<span className="rounded-md bg-muted px-2 py-1 text-xs tabular-nums">
							<span aria-hidden="true">
								{health.attentionScore}/100 attention
							</span>
							<span className="sr-only">
								Attention weight {health.attentionScore} out of 100
							</span>
						</span>
					) : null}
				</div>
				{health.unknown.length ? (
					<ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
						{health.unknown.map((message) => (
							<li key={message}>{message}</li>
						))}
					</ul>
				) : null}
				<div className="mt-3 divide-y">
					{health.signals.map((signal) => (
						<details key={signal.id} className="py-3">
							<summary className="cursor-pointer font-medium text-sm">
								{signal.title}
								<span className="ml-2 font-normal text-muted-foreground">
									Show evidence
								</span>
							</summary>
							<p className="mt-2 text-sm text-muted-foreground">
								{signal.explanation}
							</p>
							<dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
								<dt className="text-muted-foreground">Source</dt>
								<dd className="min-w-0 break-all">
									{signal.evidence.model} · {signal.evidence.recordId}
								</dd>
								<dt className="text-muted-foreground">Field</dt>
								<dd>{signal.evidence.field}</dd>
								<dt className="text-muted-foreground">Recorded value</dt>
								<dd className="min-w-0 break-words">
									{signal.evidence.value ?? "Not recorded"}
								</dd>
								<dt className="text-muted-foreground">Rule weight</dt>
								<dd>{signal.weight} attention points</dd>
							</dl>
							<p className="mt-3 text-sm">{signal.recommendation}</p>
						</details>
					))}
				</div>
				{health.signals.length ? (
					<Button
						size="sm"
						variant="outline"
						className="mt-3"
						onClick={onReviewActivity}
					>
						Review activity and next steps
					</Button>
				) : null}
				<details className="mt-4 text-xs text-muted-foreground">
					<summary className="cursor-pointer">
						What this check does not know
					</summary>
					<p className="mt-2">
						{health.notEvaluated.join(" · ")}. A clear check is not a guarantee
						of deal health.
					</p>
					<p className="mt-2">
						Rules: {health.ruleset}. Business dates: {health.timeZone}.
						Evaluated {health.checkedAt}.
					</p>
				</details>
			</div>
		</DetailSheetSection>
	);
}
