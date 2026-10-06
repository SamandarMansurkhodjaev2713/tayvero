// Synthetic state examples only. No customer data, credentials or executable provider actions.
const user = { id: "demo-member", name: "Demo teammate", image: null };
const stamp = "2026-10-06T05:00:00.000Z";
const capabilities = {
	readable: true,
	problem: null,
	actions: [
		{
			type: "crm.activity.create",
			provider: "crm",
			summary: "Prepare a next-step task on the selected deal.",
		},
	],
	dataScope: {
		mode: "SELECTED",
		summary: "Only the selected example deal.",
		resources: [{ id: "example-deal", kind: "deal", label: "Example renewal" }],
	},
	channel: null,
};
const reviewVersion = {
	id: "example-version",
	number: 2,
	status: "READY",
	modelId: "example-model",
	sandboxPolicy: {},
	sourceConversationId: "example-conversation",
	manifest: {
		name: "Renewal preparation",
		description: "Prepare the next step for an upcoming renewal.",
		access: ["crm:read"],
		triggers: [{ type: "MANUAL", summary: "When a teammate starts it" }],
		actions: [{ summary: "Prepare a next-step task" }],
		dataScope: { summary: "Only the selected example deal" },
	},
};
export const exampleAgent = {
	id: "example-agent",
	name: "Renewal preparation",
	description: "Prepare the next step for an upcoming renewal.",
	status: "LIVE",
	createdById: user.id,
	createdBy: user,
	canManage: true,
	createdAt: stamp,
	updatedAt: stamp,
	currentVersion: {
		id: reviewVersion.id,
		number: 2,
		status: "DEPLOYED",
		manifest: {},
		modelId: "example-model",
		sandboxPolicy: {},
		approvedAt: stamp,
		deployedAt: stamp,
	},
	reviewVersion: null,
	triggers: [],
	runCount: 0,
	capabilities,
};
export const exampleRun = {
	id: "example-run-001",
	status: "SUCCEEDED",
	triggerType: "MANUAL",
	summary: "Prepared the renewal next step on the selected example deal.",
	modelId: "example-model",
	inputTokens: 100,
	outputTokens: 40,
	costUsd: "0.012",
	errorCode: null,
	errorMessage: null,
	createdAt: stamp,
	startedAt: stamp,
	finishedAt: "2026-10-06T05:00:05.000Z",
	initiatedBy: user,
	version: { id: reviewVersion.id, number: 2 },
	totalEvents: 0,
	eventsTruncated: false,
	canCancel: false,
	events: [],
	actions: [],
	totalActions: 0,
	actionsTruncated: false,
	canRetry: false,
	retryBlockedReason: "Only a failed or cancelled run can be retried.",
};
export const agentJourneyScenarios = {
	firstRun: { agent: exampleAgent, runs: [] },
	draftReady: {
		agent: {
			...exampleAgent,
			status: "DRAFT",
			currentVersion: null,
			reviewVersion,
		},
		runs: [],
	},
	draftPending: {
		agent: {
			...exampleAgent,
			status: "DRAFT",
			currentVersion: null,
			reviewVersion: { ...reviewVersion, status: "DRAFT" },
		},
		runs: [],
	},
	member: { agent: { ...exampleAgent, canManage: false }, runs: [] },
	paused: { agent: { ...exampleAgent, status: "PAUSED" }, runs: [] },
	eventOnly: {
		agent: {
			...exampleAgent,
			triggers: [
				{
					id: "example-event",
					type: "EVENT",
					name: "Selected record changes",
					config: {},
					enabled: true,
					nextRunAt: null,
					lastRunAt: null,
				},
			],
		},
		runs: [],
	},
	queued: {
		agent: { ...exampleAgent, runCount: 1 },
		runs: [
			{
				...exampleRun,
				status: "QUEUED",
				summary: null,
				startedAt: null,
				finishedAt: null,
				costUsd: null,
				canCancel: true,
			},
		],
	},
	waiting: {
		agent: { ...exampleAgent, runCount: 1 },
		runs: [
			{
				...exampleRun,
				status: "WAITING_FOR_APPROVAL",
				summary: null,
				finishedAt: null,
				canCancel: true,
			},
		],
	},
	result: { agent: { ...exampleAgent, runCount: 1 }, runs: [exampleRun] },
};
export const retryableRun = {
	...exampleRun,
	status: "FAILED",
	summary: null,
	errorCode: "MODEL_OUTPUT_INVALID",
	errorMessage: "The model output could not be validated.",
	canRetry: true,
	retryBlockedReason: null,
};
export const blockedRun = {
	...retryableRun,
	canRetry: false,
	retryBlockedReason:
		"An action was attempted or completed. A whole-run retry could duplicate it; review receipts and outcomes first.",
	totalActions: 1,
	actions: [
		{
			id: "example-receipt",
			type: "crm.activity.create",
			provider: "crm",
			targetType: "deal",
			targetId: "example-deal",
			targetLabel: "Example renewal",
			summary: "Created a next-step task",
			status: "SUCCEEDED",
			externalId: "example-task-reference",
			attemptCount: 1,
			errorCode: null,
			errorMessage: null,
			plannedAt: stamp,
			startedAt: stamp,
			completedAt: stamp,
		},
	],
};
