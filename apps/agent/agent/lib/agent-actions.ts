import {
	AGENT_ACTION_TYPES,
	type AgentActionType,
} from "@crm/validation/agent-manifest";

export type AgentActionExecutionMode = "GOVERNED" | "RUN_CONTROL";

export type AgentActionCapability = {
	readonly toolName: string;
	readonly executionMode: AgentActionExecutionMode;
};

/**
 * Immutable product-level bindings between deployed manifest actions and the
 * tools exposed to the agent runner. This is capability metadata only: it must
 * never be used as an executor registry or a side-effect dispatch table.
 */
export const AGENT_ACTION_CAPABILITIES = {
	[AGENT_ACTION_TYPES.CRM_ACTIVITY_CREATE]: {
		toolName: "create_crm_activity",
		executionMode: "GOVERNED",
	},
	[AGENT_ACTION_TYPES.RUN_SUMMARY]: {
		toolName: "finish_run",
		executionMode: "RUN_CONTROL",
	},
	[AGENT_ACTION_TYPES.SLACK_MESSAGE_POST]: {
		toolName: "post_slack_message",
		executionMode: "GOVERNED",
	},
} as const satisfies Record<AgentActionType, AgentActionCapability>;

export function isAgentActionType(value: string): value is AgentActionType {
	return Object.hasOwn(AGENT_ACTION_CAPABILITIES, value);
}

export function isGovernedAgentActionType(
	value: string,
): value is AgentActionType {
	return (
		isAgentActionType(value) &&
		AGENT_ACTION_CAPABILITIES[value].executionMode === "GOVERNED"
	);
}

export function agentActionToolName(type: AgentActionType): string {
	return AGENT_ACTION_CAPABILITIES[type].toolName;
}

export type AgentActionDependencyId = "slack";

export type AgentActionDependency = {
	readonly id: AgentActionDependencyId;
	readonly label: string;
	readonly resourceId: string;
	readonly fix: string;
};

export const AGENT_ACTION_DEPENDENCIES = {
	[AGENT_ACTION_TYPES.CRM_ACTIVITY_CREATE]: null,
	[AGENT_ACTION_TYPES.RUN_SUMMARY]: null,
	[AGENT_ACTION_TYPES.SLACK_MESSAGE_POST]: {
		id: "slack",
		label: "Slack",
		resourceId: "slack:workspace",
		fix: "Connect Slack in Settings → Connections.",
	},
} as const satisfies Record<AgentActionType, AgentActionDependency | null>;

export function actionDependency(
	type: AgentActionType,
): AgentActionDependency | null {
	return AGENT_ACTION_DEPENDENCIES[type];
}
