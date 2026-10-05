import type {
	DealPipelineAssignment,
	PipelineDefinition,
} from "@crm/pipeline-core";

export const MAX_PIPELINES_PER_WORKSPACE: 200;

export interface PipelineRuntimeContext {
	readonly tenantId: string;
	readonly actorId: string;
	readonly requestId: string;
	readonly permissions: readonly string[];
}

export interface PipelineCommandReceipt {
	readonly tenantId: string;
	readonly action: string;
	readonly idempotencyKey: string;
	readonly payloadHash: string;
	readonly result: unknown;
}

export interface PipelineAuditEvent {
	readonly tenantId: string;
	readonly actorId: string;
	readonly requestId: string;
	readonly action: string;
	readonly payloadHash: string;
	readonly outcome: "SUCCESS";
	readonly entityId: string | null;
}

export interface PipelineRepositoryTransaction {
	listPipelines(tenantId: string): Promise<PipelineDefinition[]>;
	getPipeline(tenantId: string, id: string): Promise<PipelineDefinition | null>;
	insertPipeline(pipeline: PipelineDefinition): Promise<PipelineDefinition>;
	replacePipeline(
		tenantId: string,
		id: string,
		expectedVersion: number,
		next: PipelineDefinition,
	): Promise<PipelineDefinition>;
	setDefault(
		tenantId: string,
		pipelineId: string,
		expectedVersion: number,
	): Promise<PipelineDefinition>;
	countOpenAssignments(tenantId: string, pipelineId: string): Promise<number>;
	countAssignmentsByStageIds(
		tenantId: string,
		pipelineId: string,
		stageIds: readonly string[],
	): Promise<number>;
	insertAssignment(
		assignment: DealPipelineAssignment,
	): Promise<DealPipelineAssignment>;
	getAssignment(
		tenantId: string,
		dealId: string,
	): Promise<DealPipelineAssignment | null>;
	replaceAssignment(
		tenantId: string,
		dealId: string,
		expectedVersion: number,
		next: DealPipelineAssignment,
	): Promise<DealPipelineAssignment>;
	getReceipt(
		tenantId: string,
		action: string,
		idempotencyKey: string,
	): Promise<PipelineCommandReceipt | null>;
	putReceipt(receipt: PipelineCommandReceipt): Promise<void>;
	appendAudit(event: PipelineAuditEvent): Promise<void>;
}

export interface PipelineRepository extends PipelineRepositoryTransaction {
	transaction<T>(
		callback: (transaction: PipelineRepositoryTransaction) => Promise<T>,
	): Promise<T>;
}

export interface PipelineRuntime {
	listPipelines(
		context: PipelineRuntimeContext,
	): Promise<readonly PipelineDefinition[]>;
	getPipeline(
		context: PipelineRuntimeContext,
		pipelineId: string,
	): Promise<PipelineDefinition | null>;
	getDealAssignment(
		context: PipelineRuntimeContext,
		dealId: string,
	): Promise<DealPipelineAssignment | null>;
	replayCommand(input: {
		context: PipelineRuntimeContext;
		action: string;
		idempotencyKey: string;
		payload: unknown;
	}): Promise<Readonly<{ found: boolean; result: unknown }>>;
	createPipeline(input: {
		context: PipelineRuntimeContext;
		idempotencyKey: string;
		definition: PipelineDefinition;
		idempotencyPayload?: unknown;
	}): Promise<PipelineDefinition>;
	updatePipeline(input: {
		context: PipelineRuntimeContext;
		idempotencyKey: string;
		definition: PipelineDefinition;
		expectedVersion: number;
		idempotencyPayload?: unknown;
	}): Promise<PipelineDefinition>;
	setDefaultPipeline(input: {
		context: PipelineRuntimeContext;
		idempotencyKey: string;
		pipelineId: string;
		expectedVersion: number;
	}): Promise<PipelineDefinition>;
	archivePipeline(input: {
		context: PipelineRuntimeContext;
		idempotencyKey: string;
		pipelineId: string;
		expectedVersion: number;
	}): Promise<PipelineDefinition>;
	restorePipeline(input: {
		context: PipelineRuntimeContext;
		idempotencyKey: string;
		pipelineId: string;
		expectedVersion: number;
	}): Promise<PipelineDefinition>;
	seedAssignmentForMigration(input: {
		context: PipelineRuntimeContext;
		assignment: DealPipelineAssignment;
	}): Promise<DealPipelineAssignment>;
	transitionDeal(input: {
		context: PipelineRuntimeContext;
		idempotencyKey: string;
		dealId: string;
		targetStageId: string;
		expectedVersion: number;
		allowReopen?: boolean;
	}): Promise<DealPipelineAssignment>;
}

export class PipelineRuntimeError extends Error {
	readonly code: string;
	readonly details: Readonly<Record<string, unknown>>;
	constructor(code: string, message: string, details?: Record<string, unknown>);
}

export function canonicalJson(value: unknown): string;
export function payloadHash(value: unknown): string;
export function createRuntimeContext(input: unknown): PipelineRuntimeContext;
export function requirePermission(
	context: PipelineRuntimeContext,
	permission: string,
): void;

export class InMemoryPipelineRepository implements PipelineRepository {
	transaction<T>(
		callback: (transaction: PipelineRepositoryTransaction) => Promise<T>,
	): Promise<T>;
	listPipelines(tenantId: string): Promise<PipelineDefinition[]>;
	getPipeline(tenantId: string, id: string): Promise<PipelineDefinition | null>;
	insertPipeline(pipeline: PipelineDefinition): Promise<PipelineDefinition>;
	replacePipeline(
		tenantId: string,
		id: string,
		expectedVersion: number,
		next: PipelineDefinition,
	): Promise<PipelineDefinition>;
	setDefault(
		tenantId: string,
		pipelineId: string,
		expectedVersion: number,
	): Promise<PipelineDefinition>;
	countOpenAssignments(tenantId: string, pipelineId: string): Promise<number>;
	countAssignmentsByStageIds(
		tenantId: string,
		pipelineId: string,
		stageIds: readonly string[],
	): Promise<number>;
	insertAssignment(
		assignment: DealPipelineAssignment,
	): Promise<DealPipelineAssignment>;
	getAssignment(
		tenantId: string,
		dealId: string,
	): Promise<DealPipelineAssignment | null>;
	replaceAssignment(
		tenantId: string,
		dealId: string,
		expectedVersion: number,
		next: DealPipelineAssignment,
	): Promise<DealPipelineAssignment>;
	getReceipt(
		tenantId: string,
		action: string,
		idempotencyKey: string,
	): Promise<PipelineCommandReceipt | null>;
	putReceipt(receipt: PipelineCommandReceipt): Promise<void>;
	appendAudit(event: PipelineAuditEvent): Promise<void>;
	audits(): Promise<PipelineAuditEvent[]>;
}

export function createPipelineRuntime(dependencies: {
	repository: PipelineRepository;
}): PipelineRuntime;

export function createPrismaPipelineRepository(
	prisma: unknown,
	options?: {
		receiptDelegate?: string;
		auditDelegate?: string;
		transactionMaxAttempts?: number;
		transactionMaxWaitMs?: number;
		transactionTimeoutMs?: number;
		retryBaseDelayMs?: number;
		retryMaxDelayMs?: number;
		sleep?: (delayMs: number) => Promise<void>;
		random?: () => number;
	},
): PipelineRepository;
