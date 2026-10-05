export type PipelineStageType = "OPEN" | "WON" | "LOST";

export type PipelineApiStage = {
	id: string;
	key: string;
	name: string;
	position: number;
	type: PipelineStageType;
	probabilityBps: number;
	color: string | null;
	allowedFromStageIds: string[];
	allowedFromStageKeys: string[];
};

export type PipelineApiModel = {
	id: string;
	name: string;
	slug: string;
	isDefault: boolean;
	isArchived: boolean;
	version: number;
	canManage: boolean;
	stages: PipelineApiStage[];
};

export type DraftStage = {
	id: string | null;
	key: string;
	name: string;
	position: number;
	type: PipelineStageType;
	probabilityBps: number;
	color: string | null;
	allowedFromStageKeys: string[];
};

export type PipelineDraft = {
	id: string | null;
	name: string;
	slug: string;
	isDefault: boolean;
	isArchived: boolean;
	version: number;
	stages: DraftStage[];
};

export type PipelineMutationStage = {
	id?: string;
	key: string;
	name: string;
	position: number;
	type: PipelineStageType;
	probabilityBps: number;
	color: string | null;
	allowedFromStageKeys: string[];
};

export type PipelineCreateMutationInput = {
	idempotencyKey: string;
	name: string;
	slug: string;
	isDefault: boolean;
	stages: PipelineMutationStage[];
};

export type PipelineUpdateMutationInput = {
	id: string;
	idempotencyKey: string;
	expectedVersion: number;
	name: string;
	slug: string;
	stages: PipelineMutationStage[];
};

export function newPipelineDraft(): PipelineDraft;
export function draftFromPipeline(pipeline: PipelineApiModel): PipelineDraft;
export function addStage(draft: PipelineDraft): PipelineDraft;
export function removeStage(draft: PipelineDraft, index: number): PipelineDraft;
export function moveStage(
	draft: PipelineDraft,
	from: number,
	to: number,
): PipelineDraft;
export function updateStage(
	draft: PipelineDraft,
	index: number,
	patch: Partial<DraftStage>,
): PipelineDraft;
export function toggleTransition(
	draft: PipelineDraft,
	targetIndex: number,
	sourceKey: string,
	checked: boolean,
): PipelineDraft;
export function validatePipelineDraft(draft: PipelineDraft): string[];
export function toCreateMutationInput(
	draft: PipelineDraft,
	idempotencyKey: string,
): PipelineCreateMutationInput;
export function toUpdateMutationInput(
	draft: PipelineDraft,
	idempotencyKey: string,
): PipelineUpdateMutationInput;
export function toMutationInput(
	draft: PipelineDraft,
	idempotencyKey: string,
): PipelineCreateMutationInput | PipelineUpdateMutationInput;
