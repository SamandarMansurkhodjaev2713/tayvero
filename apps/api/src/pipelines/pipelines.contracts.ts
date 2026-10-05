
import { z } from "zod";

const safeId = z
	.string()
	.trim()
	.min(1)
	.max(128)
	.regex(/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/);
const stageKey = z
	.string()
	.trim()
	.min(1)
	.max(63)
	.regex(/^[a-z][a-z0-9_]{0,62}$/)
	.refine((value) => !value.startsWith("zz_internal_"), {
		message: "Stage key uses a reserved internal prefix",
	});
const idempotencyKey = z
	.string()
	.min(8)
	.max(200)
	.regex(/^[A-Za-z0-9_.:-]+$/);
const positiveVersion = z.number().int().min(1);
const stageType = z.enum(["OPEN", "WON", "LOST"]);
const stageColor = z
	.string()
	.regex(/^#[0-9A-Fa-f]{6}$/)
	.nullable()
	.default(null);

const stageDraft = z
	.object({
		key: stageKey,
		name: z.string().trim().min(1).max(120),
		position: z.number().int().min(0).max(199),
		type: stageType,
		probabilityBps: z.number().int().min(0).max(10_000),
		color: stageColor,
		allowedFromStageKeys: z.array(stageKey).max(199).default([]),
	})
	.strict();

export const pipelineCreateStageInput = stageDraft;
export const pipelineUpdateStageInput = stageDraft
	.extend({ id: safeId.optional() })
	.strict();

export const pipelineListInput = z
	.object({ includeArchived: z.boolean().default(false) })
	.strict();
export const pipelineIdInput = z.object({ id: safeId }).strict();

export const pipelineCreateInput = z
	.object({
		idempotencyKey,
		name: z.string().trim().min(1).max(120),
		slug: z.string().trim().max(64).optional(),
		isDefault: z.boolean().default(false),
		stages: z.array(pipelineCreateStageInput).min(3).max(200),
	})
	.strict();
export type PipelineCreateInput = z.infer<typeof pipelineCreateInput>;

export const pipelineUpdateInput = z
	.object({
		id: safeId,
		idempotencyKey,
		expectedVersion: positiveVersion,
		name: z.string().trim().min(1).max(120),
		slug: z.string().trim().max(64).optional(),
		stages: z.array(pipelineUpdateStageInput).min(3).max(200),
	})
	.strict();
export type PipelineUpdateInput = z.infer<typeof pipelineUpdateInput>;

export const pipelineSetDefaultInput = z
	.object({
		id: safeId,
		idempotencyKey,
		expectedVersion: positiveVersion,
	})
	.strict();
export type PipelineStateCommandInput = z.infer<
	typeof pipelineSetDefaultInput
>;

export const pipelineArchiveInput = pipelineSetDefaultInput;
export const pipelineRestoreInput = pipelineSetDefaultInput;

export const pipelineStageOutput = z
	.object({
		id: safeId,
		key: stageKey,
		name: z.string().min(1).max(120),
		position: z.number().int().min(0).max(199),
		type: stageType,
		probabilityBps: z.number().int().min(0).max(10_000),
		color: stageColor,
		allowedFromStageIds: z.array(safeId).max(199),
		allowedFromStageKeys: z.array(stageKey).max(199),
	})
	.strict();

export const pipelineOutput = z
	.object({
		id: safeId,
		name: z.string().min(1).max(120),
		slug: z.string().min(1).max(64),
		isDefault: z.boolean(),
		isArchived: z.boolean(),
		version: positiveVersion,
		canManage: z.boolean(),
		stages: z.array(pipelineStageOutput).min(3).max(200),
	})
	.strict();
export type PipelineOutput = z.infer<typeof pipelineOutput>;

export const pipelineListOutput = z
	.object({
		items: z.array(pipelineOutput).max(200),
		canManage: z.boolean(),
	})
	.strict();
