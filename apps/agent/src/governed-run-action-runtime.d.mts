export const RUN_ACTION_MANIFEST_VERSION: "1.0.0";
export type GovernedRunTrustedContext = Readonly<{
	tenantId: string;
	actorId: string;
	requestId: string;
	correlationId?: string;
	permissions: readonly string[];
}>;

export type GovernedRunActionManifest = Readonly<{
	id: string;
	version: string;
	risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
	mutating: boolean;
	permissions: readonly string[];
}>;

export type CrmActivityActionInput = Readonly<{
	type: "NOTE" | "TASK";
	targetKind: "company" | "contact" | "deal";
	targetId: string;
	subject?: string | null;
	body?: string | null;
	dueAt?: string | null;
}>;

export type SlackMessageActionInput = Readonly<{ text: string }>;

export type GovernedRunActionAuthorizationRequest =
	| Readonly<{
			actionId: "crm.activity.create";
			runId: string;
			callId: string;
			input: CrmActivityActionInput;
			context: GovernedRunTrustedContext;
			manifest: GovernedRunActionManifest;
	  }>
	| Readonly<{
			actionId: "slack.message.post";
			runId: string;
			callId: string;
			input: SlackMessageActionInput;
			context: GovernedRunTrustedContext;
			manifest: GovernedRunActionManifest;
	  }>;

export type GovernedRunActionContextRequest =
	| Readonly<{
			actionId: "crm.activity.create";
			runId: string;
			callId: string;
			input: CrmActivityActionInput;
	  }>
	| Readonly<{
			actionId: "slack.message.post";
			runId: string;
			callId: string;
			input: SlackMessageActionInput;
	  }>;

export type GovernedRunActionExecutorRequest<TInput> = Readonly<{
	runId: string;
	callId: string;
	input: TInput;
	signal: AbortSignal;
	attempt: number;
	idempotencyKey: string;
	operationDigest: string;
	context: GovernedRunTrustedContext;
}>;

export type GovernedCrmActivityResult = Readonly<{
	actionId: string;
	activityId: string;
	replayed: boolean;
}>;

export type GovernedSlackMessageResult = Readonly<{
	actionId: string;
	messageId: string;
	destination: string;
	replayed: boolean;
}>;

export type GovernedRunActionRuntimeOptions = Readonly<{
	prisma: object;
	loadTrustedContext(
		request: GovernedRunActionContextRequest,
	): Promise<GovernedRunTrustedContext> | GovernedRunTrustedContext;
	authorize(
		request: GovernedRunActionAuthorizationRequest,
	): Promise<boolean> | boolean;
	evaluatePolicy(request: GovernedRunActionAuthorizationRequest):
		| Promise<
				Readonly<{
					allowed: boolean;
					requiresApproval?: boolean;
					reason?: string;
				}>
		  >
		| Readonly<{
				allowed: boolean;
				requiresApproval?: boolean;
				reason?: string;
		  }>;
	executeCrmActivity(
		request: GovernedRunActionExecutorRequest<CrmActivityActionInput>,
	): Promise<GovernedCrmActivityResult>;
	executeSlackMessage(
		request: GovernedRunActionExecutorRequest<SlackMessageActionInput>,
	): Promise<GovernedSlackMessageResult>;
	clock?: () => Date;
	approvalLifecycleWorkspaceId?: string;
	receiptModel?: string;
	approvalModel?: string;
	auditModel?: string;
	receiptLeaseMs?: number;
	maxReceiptAcquireAttempts?: number;
}>;

export type GovernedRunActionRuntime = Readonly<{
	actionIds: readonly ["crm.activity.create", "slack.message.post"];
	hasAction(actionId: string): boolean;
	listActions(): readonly GovernedRunActionManifest[];
	prepareCrmActivity(
		request: Readonly<{
			runId: string;
			callId: string;
			input: CrmActivityActionInput;
			signal?: AbortSignal;
		}>,
	): Promise<GovernedActionPreflight>;
	prepareSlackMessage(
		request: Readonly<{
			runId: string;
			callId: string;
			input: SlackMessageActionInput;
			signal?: AbortSignal;
		}>,
	): Promise<GovernedActionPreflight>;
	executeCrmActivity(
		request: Readonly<{
			runId: string;
			callId: string;
			input: CrmActivityActionInput;
			signal?: AbortSignal;
		}>,
	): Promise<GovernedCrmActivityResult>;
	executeSlackMessage(
		request: Readonly<{
			runId: string;
			callId: string;
			input: SlackMessageActionInput;
			signal?: AbortSignal;
		}>,
	): Promise<GovernedSlackMessageResult>;
}>;

export function createGovernedRunActionRuntime(
	options: GovernedRunActionRuntimeOptions,
): GovernedRunActionRuntime;

export type GovernedActionPreflight = Readonly<{
	requiresApproval: boolean;
	actionId: string;
	digest: string;
	approvalId?: string;
	status?: string;
}>;
export function normalizedRunActionInput(
	actionId: string,
	runId: string,
	callId: string,
	input: unknown,
): Record<string, unknown>;
