export const RESERVED_STAGE_KEY_PREFIX: "zz_internal_";
export type PipelineStageType = "OPEN" | "WON" | "LOST";

export interface PipelineStageDefinition {
	readonly id: string;
	readonly key: string;
	readonly name: string;
	readonly position: number;
	readonly type: PipelineStageType;
	readonly probabilityBps: number;
	readonly color: string | null;
	readonly allowedFromStageIds: readonly string[];
}

export interface PipelineDefinition {
	readonly id: string;
	readonly tenantId: string;
	readonly name: string;
	readonly slug: string;
	readonly isDefault: boolean;
	readonly isArchived: boolean;
	readonly version: number;
	readonly stages: readonly PipelineStageDefinition[];
}

export interface DealPipelineAssignment {
	readonly tenantId: string;
	readonly dealId: string;
	readonly pipelineId: string;
	readonly stageId: string;
	readonly version: number;
}

export class PipelineDomainError extends Error {
	readonly code: string;
	readonly details: Readonly<Record<string, unknown>>;
	constructor(code: string, message: string, details?: Record<string, unknown>);
}

export function normalizePipelineSlug(value: unknown): string;
export function parsePipelineDefinition(input: unknown): PipelineDefinition;
export function parseAssignment(
	input: unknown,
	path?: string,
): DealPipelineAssignment;
export function planDealStageTransition(input: {
	pipeline: unknown;
	assignment: unknown;
	targetStageId: string;
	expectedVersion: number;
	allowReopen?: boolean;
}): Readonly<{
	changed: boolean;
	assignment: DealPipelineAssignment;
	event: Readonly<Record<string, unknown>> | null;
}>;
export function buildLegacyStageMigrationPlan(
	input: unknown,
): Readonly<Record<string, unknown>>;
export function calculatePipelineAnalytics(
	input: unknown,
): Readonly<Record<string, unknown>>;
export const PipelineDefinitionJsonSchema: Readonly<Record<string, unknown>>;

export const LEGACY_DEAL_STAGES: readonly [
	"DEMO_BOOKED",
	"QUALIFIED_TO_BUY",
	"UNQUALIFIED_TO_BUY",
	"DECISION_MAKER_BOUGHT_IN",
	"CONTRACT_SENT",
	"CLOSED_WON",
	"CLOSED_LOST",
];
export type LegacyDealStage = (typeof LEGACY_DEAL_STAGES)[number];
export function parseLegacyDealStage(
	value: unknown,
	path?: string,
): LegacyDealStage;
export function compileLegacyStageMapping(input: {
	pipeline: unknown;
	mapping: unknown;
}): Readonly<{
	tenantId: string;
	pipelineId: string;
	count: number;
	digest: string;
	rows: readonly Readonly<{
		tenantId: string;
		legacyStage: LegacyDealStage;
		pipelineId: string;
		stageId: string;
	}>[];
}>;
export function reconcileLegacyStageAssignments(input: {
	pipeline: unknown;
	mapping: unknown;
	deals: unknown[];
	assignments: unknown[];
	maxRecords?: number;
}): Readonly<Record<string, unknown>>;
