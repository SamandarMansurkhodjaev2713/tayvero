// Synthetic examples for UI inspection only. No credentials, real CRM records, or provider actions.
export const agents = [
	{
		id: "follow-up",
		name: "Follow-up assistant",
		description:
			"Find overdue commitments and prepare the next step for your review.",
		status: "LIVE",
		runCount: 42,
		lastRun: {
			status: "WAITING_FOR_APPROVAL",
			costUsd: "0.024",
			createdAt: "2026-10-05T06:00:00Z",
		},
	},
	{
		id: "deal-risk",
		name: "Deal risk analyst",
		description:
			"Read deal activity and surface evidence behind a risk signal.",
		status: "LIVE",
		runCount: 86,
		lastRun: {
			status: "SUCCEEDED",
			costUsd: "0.018",
			createdAt: "2026-10-05T05:45:00Z",
		},
	},
	{
		id: "crm-hygiene",
		name: "CRM hygiene",
		description: "Identify incomplete contacts and duplicate candidates.",
		status: "PAUSED",
		runCount: 12,
		lastRun: null,
	},
];
export const summary = {
	pipeline: {
		totalCents: 24800000,
		totalDeals: 18,
		stages: [
			{ stage: "QUALIFIED_TO_BUY", valueCents: 9800000, count: 7 },
			{ stage: "DECISION_MAKER_BOUGHT_IN", valueCents: 8800000, count: 6 },
			{ stage: "CONTRACT_SENT", valueCents: 6200000, count: 5 },
		],
	},
	wonThisMonth: { valueCents: 6800000, count: 6 },
	wonPrevMonth: { valueCents: 5200000, count: 4 },
	performance: {
		windowDays: 90,
		winRate: 0.62,
		wins: 13,
		losses: 8,
		avgDealCents: 1133000,
		avgCycleDays: 18,
	},
	trend: [
		{ month: "May", won: 2200000, created: 7800000 },
		{ month: "Jun", won: 3000000, created: 10500000 },
		{ month: "Jul", won: 4400000, created: 8200000 },
		{ month: "Aug", won: 4100000, created: 13900000 },
		{ month: "Sep", won: 5200000, created: 11200000 },
		{ month: "Oct", won: 6800000, created: 15100000 },
	],
	closingThisMonthTotal: { valueCents: 8800000, count: 6 },
	reportingCurrency: "USD",
	unconverted: { count: 0, currencies: [] },
};
export const commonFixtures = {
	"workspace.get": { name: "Demo workspace", slug: "demo" },
	"agents.list": agents,
	"dashboard.summary": summary,
};
