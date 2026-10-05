import type {
	PipelineDefinition,
	PipelineDomainError,
} from "@crm/pipeline-core";
import type {
	PipelineCreateInput,
	PipelineOutput,
	PipelineUpdateInput,
} from "./pipelines.contracts";

type DeepReadonly<T> = T extends readonly (infer Item)[]
	? readonly DeepReadonly<Item>[]
	: T extends object
		? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
		: T;

export type PipelineApiOutput = DeepReadonly<PipelineOutput>;
type CreateCommandPayload = DeepReadonly<
	Omit<PipelineCreateInput, "idempotencyKey">
>;
type UpdateCommandPayload = DeepReadonly<
	Omit<PipelineUpdateInput, "idempotencyKey">
>;
export type PipelineIdFactory = (kind: string) => string;

export class PipelineApiCoreError extends Error {
	readonly code: string;
	readonly details: Readonly<Record<string, unknown>>;
	constructor(code: string, message: string, details?: Record<string, unknown>);
}
export function pipelineCreateCommandPayload(
	input: PipelineCreateInput,
): CreateCommandPayload;
export function pipelineUpdateCommandPayload(
	input: PipelineUpdateInput,
): UpdateCommandPayload;
export function createDeterministicPipelineIdFactory(input: {
	tenantId: string;
	idempotencyKey: string;
	pipelineId?: string | null;
}): PipelineIdFactory;
export function permissionsForWorkspaceRole(role: string): readonly string[];
export function canManagePipelines(role: unknown): boolean;
export function createPipelineDefinition(input: {
	tenantId: string;
	input: PipelineCreateInput;
	idFactory: PipelineIdFactory;
}): PipelineDefinition;
export function updatePipelineDefinition(input: {
	current: PipelineDefinition;
	input: PipelineUpdateInput;
	idFactory: PipelineIdFactory;
}): PipelineDefinition;
export function toPipelineApiModel(
	pipelineInput: unknown,
	canManage: boolean,
): PipelineApiOutput;
export function isPipelineInputError(
	error: unknown,
): error is PipelineApiCoreError | PipelineDomainError;
