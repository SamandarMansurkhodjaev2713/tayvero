export type DealHealthSignal = {
	id: string;
	weight: number;
	title: string;
	explanation: string;
	recommendation: string;
	evidence: {
		model: string;
		recordId: string;
		field: string;
		value: string | null;
		checkedAt: string;
	};
};
export type DealHealth = {
	ruleset: string;
	checkedAt: string;
	timeZone: string;
	status: "CLEAR" | "NEEDS_ATTENTION" | "INSUFFICIENT_DATA" | "NOT_APPLICABLE";
	attentionScore: number | null;
	signals: DealHealthSignal[];
	unknown: string[];
	notEvaluated: string[];
};
export const DEAL_HEALTH_RULESET: string;
export function evaluateDealHealth(
	source: {
		id: string;
		stage: string;
		createdAt: Date | string;
		stageChangedAt: Date | string;
		archivedAt?: Date | string | null;
		lastActivityAt?: Date | string | null;
		expectedCloseDate?: Date | string | null;
		pendingTaskCount?: number;
		nextTask?: {
			id: string;
			dueAt: Date | string | null;
		} | null;
		contactCount: number;
	},
	options?: {
		now?: Date;
		timeZone?: string;
	},
): DealHealth;
