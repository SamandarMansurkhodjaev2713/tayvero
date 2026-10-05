import type {
	PipelineDefinition,
	PipelineDomainError,
} from "@crm/pipeline-core";
import type {
	PipelineCreateInput,
	PipelineOutput,
	PipelineUpdateInput,
} from "./pipelines.contracts";

export class PipelineApiCoreError extends Error {
	readonly code: string;
	readonly details: Readonly<Record<string, unknown>>;
}
export function permissionsForWorkspaceRole(role: string): readonly string[];
export function canManagePipelines(role: string): boolean;
export function pipelineCreateCommandPayload(
	input: PipelineCreateInput,
): Readonly<Omit<PipelineCreateInput, "idempotencyKey">>;
export function pipelineUpdateCommandPayload(
	input: PipelineUpdateInput,
): Readonly<Omit<PipelineUpdateInput, "idempotencyKey">>;
export function createDeterministicPipelineIdFactory(input: {
	tenantId: string;
	idempotencyKey: string;
	pipelineId?: string | null;
}): (kind: string) => string;
export function createPipelineDefinition(input: {
	tenantId: string;
	input: PipelineCreateInput;
	idFactory: (kind: string) => string;
}): PipelineDefinition;
export function updatePipelineDefinition(input: {
	current: PipelineDefinition;
	input: PipelineUpdateInput;
	idFactory: (kind: string) => string;
}): PipelineDefinition;
export function toPipelineApiModel(
	pipeline: unknown,
	canManage: boolean,
): PipelineOutput;
export function isPipelineInputError(
	error: unknown,
): error is PipelineApiCoreError | PipelineDomainError;
