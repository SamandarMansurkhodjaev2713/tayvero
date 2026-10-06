export const FOLLOW_UP_LIMIT: 100;
export type FollowUpBucket = "overdue" | "today" | "undated" | "upcoming";
export type FollowUpState = "loading" | "error" | "stale" | "ready";
export function classifyFollowUpDeadline(
	dueAt: string | null,
	now: Date,
	timeZone?: string,
): FollowUpBucket;
export function groupFollowUps<
	T extends { dueAt: string | null; completedAt: string | null },
>(
	tasks: readonly T[],
	now: Date,
	timeZone?: string,
): Record<FollowUpBucket, T[]>;
export function followUpLoadState(
	data: readonly unknown[] | undefined,
	isError: boolean,
	clockReady: boolean,
): FollowUpState;
export function removeConfirmedFollowUp<T extends { id: string }>(
	tasks: T[] | undefined,
	result: { id: string; completedAt: string | null },
): T[] | undefined;
