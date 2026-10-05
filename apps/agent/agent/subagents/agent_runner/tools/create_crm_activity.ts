import { defineTool } from "eve/tools";
import { z } from "zod";
import { continuationEnabled } from "../../../lib/approval-continuation";
import {
	approveGovernedRunActivity,
	createGovernedRunActivity,
} from "../../../lib/governed-run-actions";
import { requireTeamAgentAttribute } from "../../../lib/session-purpose";

const actionInput = z.object({
	type: z.enum(["NOTE", "TASK"]),
	targetKind: z.enum(["company", "contact", "deal"]),
	targetId: z.string().min(1),
	subject: z.string().trim().max(240).nullish(),
	body: z.string().trim().max(10_000).nullish(),
	dueAt: z.string().nullish(),
});

export default defineTool({
	description:
		"Create an approved internal CRM note or task on an approved record. The version must allow the exact activity type. The action is logged before it executes and is idempotent across retries.",
	inputSchema: actionInput,
	approval: (ctx) => {
		if (!continuationEnabled()) return false;
		const input = actionInput.safeParse(ctx.toolInput);
		if (!input.success) return "denied" as const;
		return approveGovernedRunActivity(
			requireTeamAgentAttribute(ctx, "runId"),
			ctx.callId,
			ctx.session.id,
			input.data,
		);
	},

	async execute(input, ctx) {
		return createGovernedRunActivity(
			requireTeamAgentAttribute(ctx, "runId"),
			ctx.callId,
			input,
			ctx.abortSignal,
			ctx.session.id,
		);
	},
});
