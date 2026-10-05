import type { DealStage, Prisma } from "@crm/db";
import { Injectable, InternalServerErrorException } from "@nestjs/common";
import {
	parseDealPipelineDualWriteMode,
	planLegacyStageAssignmentSync,
} from "./deal-pipeline-bridge-core.mjs";

@Injectable()
export class DealPipelineBridgeService {
	private readonly mode = parseDealPipelineDualWriteMode(
		process.env.CRM_PIPELINE_DUAL_WRITE_MODE,
	);

	async syncLegacyStage(
		tx: Prisma.TransactionClient,
		input: {
			workspaceId: string;
			dealId: string;
			legacyStage: DealStage;
			changedAt: Date;
		},
	): Promise<{ enabled: boolean; changed: boolean }> {
		if (this.mode === "off") return { enabled: false, changed: false };

		const mapping = await tx.crmLegacyDealStageMapping.findUnique({
			where: {
				workspaceId_legacyStage: {
					workspaceId: input.workspaceId,
					legacyStage: input.legacyStage,
				},
			},
			include: {
				pipeline: { select: { id: true, isDefault: true, isArchived: true } },
				stage: { select: { id: true, pipelineId: true, stageType: true } },
			},
		});
		const assignment = await tx.crmDealPipelineAssignment.findUnique({
			where: {
				workspaceId_dealId: {
					workspaceId: input.workspaceId,
					dealId: input.dealId,
				},
			},
			select: {
				workspaceId: true,
				dealId: true,
				pipelineId: true,
				stageId: true,
				version: true,
			},
		});

		let plan: ReturnType<typeof planLegacyStageAssignmentSync>;
		try {
			plan = planLegacyStageAssignmentSync({ ...input, mapping, assignment });
		} catch (error) {
			throw new InternalServerErrorException(
				"Deal pipeline dual-write is not ready; legacy write was rolled back.",
				{ cause: error },
			);
		}
		if (plan.action === "none") return { enabled: true, changed: false };
		if (plan.action === "create") {
			await tx.crmDealPipelineAssignment.create({ data: plan.data });
			return { enabled: true, changed: true };
		}
		const updated = await tx.crmDealPipelineAssignment.updateMany({
			where: {
				workspaceId: input.workspaceId,
				dealId: input.dealId,
				version: plan.expectedVersion,
			},
			data: plan.data,
		});
		if (updated.count !== 1) {
			throw new InternalServerErrorException(
				"Deal pipeline dual-write lost a concurrency race; legacy write was rolled back.",
			);
		}
		return { enabled: true, changed: true };
	}
}
