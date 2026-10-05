import type { DealStage } from "@crm/db";

export function parseDealPipelineDualWriteMode(
	value: unknown,
): "off" | "strict";

type Mapping = Readonly<{
	workspaceId: string;
	legacyStage: DealStage;
	pipelineId: string;
	stageId: string;
	pipeline: Readonly<{
		id: string;
		isDefault: boolean;
		isArchived: boolean;
	}> | null;
	stage: Readonly<{
		id: string;
		pipelineId: string;
		stageType: "OPEN" | "WON" | "LOST";
	}> | null;
}>;
type Assignment = Readonly<{
	workspaceId: string;
	dealId: string;
	pipelineId: string;
	stageId: string;
	version: number;
}>;
export type LegacyStageAssignmentPlan =
	| Readonly<{ action: "none"; expectedVersion: number }>
	| Readonly<{
			action: "create";
			data: Readonly<{
				workspaceId: string;
				dealId: string;
				pipelineId: string;
				stageId: string;
				version: 1;
				enteredAt: Date;
			}>;
	  }>
	| Readonly<{
			action: "update";
			expectedVersion: number;
			data: Readonly<{
				pipelineId: string;
				stageId: string;
				version: number;
				enteredAt: Date;
			}>;
	  }>;
export function planLegacyStageAssignmentSync(input: {
	workspaceId: string;
	dealId: string;
	legacyStage: DealStage;
	changedAt: Date | string | number;
	mapping: Mapping | null;
	assignment: Assignment | null;
}): LegacyStageAssignmentPlan;
