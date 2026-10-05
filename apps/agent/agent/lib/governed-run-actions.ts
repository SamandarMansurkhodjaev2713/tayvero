import { db } from "@crm/db";
import { WORKSPACE_ID } from "@crm/db/workspace";
import {
	AGENT_ACTION_TYPES,
	parseAgentManifest,
} from "@crm/validation/agent-manifest";
import { deploymentActionPolicy } from "../../src/governed-action-policy.mjs";
import {
	type CrmActivityActionInput,
	createGovernedRunActionRuntime,
	type GovernedRunActionAuthorizationRequest,
	type GovernedRunActionContextRequest,
	type GovernedRunTrustedContext,
	type SlackMessageActionInput,
} from "../../src/governed-run-action-runtime.mjs";
import { isGovernedAgentActionType } from "./agent-actions";
import {
	actionPayloadDigest,
	continuationEnabled,
	continuationStore,
} from "./approval-continuation";
import {
	authorizeRunActivityAction,
	authorizeRunSlackAction,
	executeRunActivitySideEffect,
	executeRunSlackMessageSideEffect,
} from "./run-runtime";

const currentDeploymentPolicy = deploymentActionPolicy();

type TrustedRun = Readonly<{
	id: string;
	correlationId: string;
}>;

function runActorId(runId: string): string {
	return `agent-run:${runId}`;
}

function runRequestId(runId: string, callId: string): string {
	return `agent-action:${runId}:${callId}`;
}

async function trustedRun(
	runId: string,
	actionId: string,
): Promise<TrustedRun> {
	if (!isGovernedAgentActionType(actionId)) {
		throw new Error(`Action ${actionId} is not a governed run action.`);
	}

	const run = await db.agentRun.findUnique({
		where: { id: runId },
		select: {
			id: true,
			status: true,
			correlationId: true,
			version: { select: { manifest: true } },
		},
	});
	if (!run) throw new Error("This agent run is unavailable.");
	if (run.status !== "RUNNING") {
		throw new Error("This agent run is not active.");
	}

	const manifest = parseAgentManifest(run.version.manifest);
	if (!manifest.actions.some((action) => action.type === actionId)) {
		throw new Error(`The deployed agent version does not allow ${actionId}.`);
	}

	return Object.freeze({
		id: run.id,
		correlationId: run.correlationId,
	});
}

async function loadTrustedContext(
	input: GovernedRunActionContextRequest,
): Promise<GovernedRunTrustedContext> {
	const run = await trustedRun(input.runId, input.actionId);
	return Object.freeze({
		tenantId: WORKSPACE_ID,
		actorId: runActorId(run.id),
		requestId: runRequestId(run.id, input.callId),
		correlationId: run.correlationId,
		permissions: Object.freeze([input.actionId]),
	});
}

function contextMatchesRun(
	request: GovernedRunActionAuthorizationRequest,
	run: TrustedRun,
): boolean {
	return (
		request.context.tenantId === WORKSPACE_ID &&
		request.context.actorId === runActorId(run.id) &&
		request.context.requestId === runRequestId(run.id, request.callId) &&
		request.context.correlationId === run.correlationId &&
		request.context.permissions.length === 1 &&
		request.context.permissions[0] === request.actionId
	);
}

async function authorize(
	request: GovernedRunActionAuthorizationRequest,
): Promise<boolean> {
	const run = await trustedRun(request.runId, request.actionId);
	if (!contextMatchesRun(request, run)) return false;

	if (request.actionId === AGENT_ACTION_TYPES.CRM_ACTIVITY_CREATE) {
		return authorizeRunActivityAction(request.runId, request.input);
	}
	if (request.actionId === AGENT_ACTION_TYPES.SLACK_MESSAGE_POST) {
		return authorizeRunSlackAction(request.runId);
	}
	return false;
}

async function evaluatePolicy(
	request: GovernedRunActionAuthorizationRequest,
): Promise<
	Readonly<{ allowed: boolean; requiresApproval: boolean; reason?: string }>
> {
	const run = await trustedRun(request.runId, request.actionId);
	if (!contextMatchesRun(request, run)) {
		return Object.freeze({
			allowed: false,
			requiresApproval: false,
			reason: "The trusted run context does not match the deployed agent run.",
		});
	}

	// Deploying an immutable agent version is the explicit human approval boundary
	// for these bounded internal-write and internal-communication capabilities.
	// The manifest fixes the activity type, record scope, integration and Slack
	// destination; runtime authorization is repeated immediately before execution.
	const decision = currentDeploymentPolicy(request);
	// Lowering deployment policy cannot revoke the binding of an already parked exact action.
	if (decision.allowed && continuationEnabled()) {
		const existing = await db.governedActionContinuation.findFirst({
			where: {
				workspaceId: WORKSPACE_ID,
				runId: request.runId,
				callId: request.callId,
			},
			select: { id: true },
		});
		if (existing) return { ...decision, requiresApproval: true };
	}
	return decision;
}

const governedRunActions = createGovernedRunActionRuntime({
	prisma: db,
	approvalLifecycleWorkspaceId:
		process.env.AGENT_APPROVAL_CENTER_ENABLED === "1"
			? WORKSPACE_ID
			: undefined,
	loadTrustedContext,
	authorize,
	evaluatePolicy,
	executeCrmActivity: async (request) =>
		executeRunActivitySideEffect(request.runId, request.callId, request.input, {
			idempotencyKey: request.idempotencyKey,
			operationDigest: request.operationDigest,
			attempt: request.attempt,
			signal: request.signal,
		}),
	executeSlackMessage: async (request) =>
		executeRunSlackMessageSideEffect(
			request.runId,
			request.callId,
			request.input,
			{
				idempotencyKey: request.idempotencyKey,
				operationDigest: request.operationDigest,
				attempt: request.attempt,
				signal: request.signal,
			},
		),
});

export async function createGovernedRunActivity(
	runId: string,
	callId: string,
	input: CrmActivityActionInput,
	signal?: AbortSignal,
	sessionId?: string,
) {
	const identity = await guardContinuation(
		"crm.activity.create",
		runId,
		callId,
		input,
		sessionId,
	);
	const result = await governedRunActions.executeCrmActivity({
		runId,
		callId,
		input,
		signal,
	});
	if (identity) await continuationStore().observeSuccess(identity);
	return result;
}

export async function postGovernedRunSlackMessage(
	runId: string,
	callId: string,
	input: SlackMessageActionInput,
	signal?: AbortSignal,
	sessionId?: string,
) {
	const identity = await guardContinuation(
		"slack.message.post",
		runId,
		callId,
		input,
		sessionId,
	);
	const result = await governedRunActions.executeSlackMessage({
		runId,
		callId,
		input,
		signal,
	});
	if (identity) await continuationStore().observeSuccess(identity);
	return result;
}

async function guardContinuation(
	actionId: string,
	runId: string,
	callId: string,
	input: unknown,
	sessionId?: string,
) {
	if (!continuationEnabled()) return null;
	if (!sessionId)
		throw new Error("A native session identity is required for this action.");
	const identity = {
		runId,
		callId,
		sessionId,
		payloadDigest: actionPayloadDigest(actionId, runId, callId, input),
	};
	await continuationStore().assertExecution(identity);
	return identity;
}
async function prepareNative(
	toolName: "create_crm_activity" | "post_slack_message",
	runId: string,
	callId: string,
	sessionId: string,
	input: CrmActivityActionInput | SlackMessageActionInput,
) {
	if (!continuationEnabled()) return false;
	const request = { runId, callId, input };
	const prepared =
		toolName === "create_crm_activity"
			? await governedRunActions.prepareCrmActivity({
					...request,
					input: input as CrmActivityActionInput,
				})
			: await governedRunActions.prepareSlackMessage({
					...request,
					input: input as SlackMessageActionInput,
				});
	if (!prepared.requiresApproval) return false;
	if (!prepared.approvalId)
		throw new Error("The approval preflight has no durable request.");
	const ticket = await continuationStore().prepare({
		runId,
		callId,
		sessionId,
		toolName,
		approvalId: prepared.approvalId,
		payloadDigest: prepared.digest,
	});
	if (
		["DISPATCHING", "DELIVERED", "COMPLETED"].includes(ticket.status) &&
		ticket.decision === "approve" &&
		["APPROVED", "CONSUMED"].includes(prepared.status ?? "")
	)
		return false;
	if (
		ticket.decision === "deny" ||
		["REJECTED", "EXPIRED", "CANCELLED"].includes(prepared.status ?? "")
	)
		return "denied" as const;
	if (ticket.status === "RECONCILIATION_REQUIRED") return "denied" as const;
	return "user-approval" as const;
}
export const approveGovernedRunActivity = (
	runId: string,
	callId: string,
	sessionId: string,
	input: CrmActivityActionInput,
) => prepareNative("create_crm_activity", runId, callId, sessionId, input);
export const approveGovernedRunSlackMessage = (
	runId: string,
	callId: string,
	sessionId: string,
	input: SlackMessageActionInput,
) => prepareNative("post_slack_message", runId, callId, sessionId, input);
