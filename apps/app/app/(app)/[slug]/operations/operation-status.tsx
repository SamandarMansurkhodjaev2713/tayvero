import { WorkspaceStatus } from "@crm/ui/components/workspace";
import type { OperationsKey } from "@/lib/operations-catalog.mjs";

const riskLabels: Record<string, OperationsKey> = {
	LOW: "riskLow",
	MEDIUM: "riskMedium",
	HIGH: "riskHigh",
	CRITICAL: "riskCritical",
};

export function approvalRisk(
	value: string,
	text: Record<OperationsKey, string>,
) {
	const key = riskLabels[value];
	return key ? text[key] : value;
}

const labels: Record<string, OperationsKey> = {
	PENDING: "pending",
	APPROVED: "approved",
	REJECTED: "rejectedState",
	EXPIRED: "expired",
	CANCELLED: "cancelled",
	CONSUMED: "consumed",
	SUCCEEDED: "succeeded",
	FAILED: "failed",
	QUEUED: "queued",
	RUNNING: "running",
	WAITING_FOR_APPROVAL: "pending",
	PLANNED: "planned",
	LIVE: "live",
	PAUSED: "paused",
	ARCHIVED: "archived",
	READY: "ready",
	IMPORTING: "importing",
	COMPLETED: "completed",
	PREPARED: "continuationPrepared",
	BOUND: "continuationBound",
	DISPATCHING: "continuationDispatching",
	DELIVERED: "continuationDelivered",
	RECONCILIATION_REQUIRED: "continuationAttention",
	CREATED: "created",
	DUPLICATE: "duplicateState",
	SKIPPED: "skippedState",
	ROLLED_BACK: "rolledBack",
};

export function operationState(
	value: string,
	text: Record<OperationsKey, string>,
) {
	const key = labels[value];
	return key ? text[key] : value;
}

export function OperationStatus({
	value,
	text,
	label,
}: {
	value: string;
	text: Record<OperationsKey, string>;
	label?: string;
}) {
	const tone = ["FAILED", "REJECTED"].includes(value)
		? "danger"
		: [
					"PENDING",
					"WAITING_FOR_APPROVAL",
					"RECONCILIATION_REQUIRED",
					"EXPIRED",
				].includes(value)
			? "warning"
			: ["SUCCEEDED", "COMPLETED", "CREATED"].includes(value)
				? "success"
				: "neutral";
	return (
		<WorkspaceStatus tone={tone}>
			{label ?? operationState(value, text)}
		</WorkspaceStatus>
	);
}
