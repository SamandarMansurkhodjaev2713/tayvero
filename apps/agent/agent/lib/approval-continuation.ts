import { createApprovalContinuationStore } from "@crm/agent-action-runtime/continuation";
import { sha256Hex } from "@crm/agent-action-runtime/digest";
import { db } from "@crm/db";
import { WORKSPACE_ID } from "@crm/db/workspace";
import { schemas } from "@crm/validation";
import {
	authenticateContinuationRequest,
	createExactSessionTransport,
} from "../../src/approval-continuation-transport.mjs";
import {
	normalizedRunActionInput,
	RUN_ACTION_MANIFEST_VERSION,
} from "../../src/governed-run-action-runtime.mjs";
import { DISPATCH } from "./dispatch-config";
import { attribute, purposeOf } from "./session-purpose";

type Context = Parameters<typeof purposeOf>[0] & { session: { id: string } };
const ACTIONS = {
	create_crm_activity: "crm.activity.create",
	post_slack_message: "slack.message.post",
} as const;
export function continuationEnabled(): boolean {
	if (process.env.AGENT_APPROVAL_CONTINUATION_ENABLED !== "1") return false;
	if (
		process.env.AGENT_APPROVAL_CENTER_ENABLED !== "1" ||
		!process.env.AGENT_BRIDGE_SECRET
	) {
		throw new Error(
			"Native continuation requires bound approvals and the internal bridge secret.",
		);
	}
	return true;
}
let store: ReturnType<typeof createApprovalContinuationStore> | undefined;
export function continuationStore() {
	if (!continuationEnabled())
		throw new Error("Approval continuation is disabled.");
	store ??= createApprovalContinuationStore({
		prisma: db,
		workspaceId: WORKSPACE_ID,
		executionBudgetMs: DISPATCH.run.executionTimeoutMs,
	});
	return store;
}
export function actionPayloadDigest(
	actionId: string,
	runId: string,
	callId: string,
	input: unknown,
): string {
	return sha256Hex({
		tenantId: WORKSPACE_ID,
		actionId,
		manifestVersion: RUN_ACTION_MANIFEST_VERSION,
		input: normalizedRunActionInput(actionId, runId, callId, input),
	});
}
/** Run before non-critical audit logging. Framework journal, not model text, binds the native request. */
export async function observeNativeApprovalEvent(
	event: { type: string; data?: unknown; meta?: { id?: string } },
	ctx: Context,
): Promise<void> {
	if (!continuationEnabled() || purposeOf(ctx) !== "team-agent") return;
	const runId = attribute(ctx, "runId");
	if (!runId || !["input.requested", "session.waiting"].includes(event.type))
		return;
	if (!event.meta?.id)
		throw new Error(
			"A durable native event ID is required for approval continuation.",
		);
	const sessionId = ctx.session.id;
	if (event.type === "session.waiting") {
		await continuationStore().park({
			runId,
			sessionId,
			eventId: event.meta.id,
		});
		return;
	}
	const data = schemas.agents.inputRequested.parse(event.data);
	for (const request of data.requests) {
		if (request.kind !== "tool-approval") continue;
		const toolName = request.action.toolName;
		if (toolName !== "create_crm_activity" && toolName !== "post_slack_message")
			continue;
		// A forwarded parent event is NOT the child session's input request.
		const ticket = await db.governedActionContinuation.findFirst({
			where: {
				workspaceId: WORKSPACE_ID,
				runId,
				sessionId,
				callId: request.action.callId,
			},
			select: { id: true },
		});
		if (!ticket) continue;
		await continuationStore().bind({
			runId,
			sessionId,
			callId: request.action.callId,
			toolName,
			requestId: request.requestId,
			turnId: data.turnId,
			sequence: data.sequence,
			eventId: event.meta.id,
			payloadDigest: actionPayloadDigest(
				ACTIONS[toolName],
				runId,
				request.action.callId,
				request.action.input,
			),
		});
	}
}
export async function drainApprovalContinuations(): Promise<number> {
	if (!continuationEnabled()) return 0;
	const secret = process.env.AGENT_BRIDGE_SECRET;
	if (!secret) throw new Error("Internal bridge is not configured.");
	const transport = createExactSessionTransport({
		baseUrl: process.env.AGENT_URL?.trim() || "http://127.0.0.1:2000",
		secret,
	});
	const lifecycle = continuationStore();
	const ids = await lifecycle.candidates();
	// Bounded, server-owned work queue; one claim per run is enforced in the transaction.
	for (const id of ids) {
		try {
			await lifecycle.dispatch(id, transport);
		} catch {
			console.warn(
				"[continuation] dispatch blocked; inspect saved continuation state",
				{ continuationId: id },
			);
		}
	}
	return ids.length;
}
export async function authenticateNativeContinuation(request: Request) {
	if (!continuationEnabled()) return null;
	const secret = process.env.AGENT_BRIDGE_SECRET;
	if (!secret) return null;
	return authenticateContinuationRequest(request, secret, (claim) =>
		continuationStore().admitDelivery(claim),
	);
}
