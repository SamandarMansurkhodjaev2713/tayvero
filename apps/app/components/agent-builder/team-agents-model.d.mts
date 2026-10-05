type AgentRow = {
	id: string;
	name: string;
	description?: string | null;
	status: string;
	lastRun?: {
		status: string;
		costUsd?: string | null;
	} | null;
};
export const TEAM_VIEWS: readonly string[];
export function latestRunNeedsReview(agent: AgentRow): boolean;
export function summarizeTeamAgents(rows: AgentRow[]): Readonly<{
	visible: number;
	live: number;
	paused: number;
	needsReview: number;
	latestRunCoverage: number;
}>;
export function filterTeamAgents<T extends AgentRow>(
	rows: T[],
	options?: {
		query?: string;
		view?: string;
	},
): T[];
export function displayRunCost(value: string | null | undefined): string;
