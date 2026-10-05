import { continuationEnabled } from "../../../lib/approval-continuation";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { postGovernedRunSlackMessage, approveGovernedRunSlackMessage } from "../../../lib/governed-run-actions";
import { requireTeamAgentAttribute } from "../../../lib/session-purpose";

const actionInput = z.object({
		text: z.string().trim().min(1).max(4_000),
	});

export default defineTool({
	description:
		"Post one message to the exact Slack channel or person approved in the deployed version. The destination comes from the manifest and the action is idempotent across retries.",
	inputSchema: actionInput,
	approval: ctx => {
    if (!continuationEnabled()) return false;
    const input = actionInput.safeParse(ctx.toolInput);
    if (!input.success) return "denied" as const;
    return approveGovernedRunSlackMessage(requireTeamAgentAttribute(ctx, "runId"), ctx.callId, ctx.session.id, input.data);
  },

	async execute(input, ctx) {
		return postGovernedRunSlackMessage(
			requireTeamAgentAttribute(ctx, "runId"),
			ctx.callId,
			input,
			ctx.abortSignal,
			ctx.session.id,
		);
	},
});
