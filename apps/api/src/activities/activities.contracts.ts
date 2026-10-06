import { ActivityType } from "@crm/db";
import { activityMeta } from "@crm/validation/activity-meta";
import { z } from "zod";

const COMPOSABLE_TYPES = [
	ActivityType.NOTE,
	ActivityType.CALL,
	ActivityType.EMAIL,
	ActivityType.MEETING,
	ActivityType.TASK,
] as const;

const composableEnum = z.enum(COMPOSABLE_TYPES);

const ALL_ACTIVITY_TYPES = [
	ActivityType.NOTE,
	ActivityType.CALL,
	ActivityType.EMAIL,
	ActivityType.MEETING,
	ActivityType.TASK,
	ActivityType.STAGE_CHANGE,
	ActivityType.ENRICHMENT,
] as const;

const activityTypeOutput = z.enum(ALL_ACTIVITY_TYPES);

const TIMELINE_FILTERS = [
	"all",
	"history",
	"notes",
	"upcoming",
	"done",
	"email",
	"meetings",
] as const;

export type TimelineFilter = (typeof TIMELINE_FILTERS)[number];

export const timelineInput = z.object({
	companyId: z.string().optional(),
	contactId: z.string().optional(),
	dealId: z.string().optional(),
	filter: z.enum(TIMELINE_FILTERS).default("all"),
	cursor: z.string().optional(),
	limit: z.number().int().min(1).max(100).default(30),
});

export type TimelineInput = z.infer<typeof timelineInput>;

export const timelineCountsInput = z.object({
	companyId: z.string().optional(),
	contactId: z.string().optional(),
	dealId: z.string().optional(),
});

export const activityCreateInput = z
	.object({
		type: composableEnum,
		subject: z.string().trim().optional(),
		body: z.string().trim().optional(),
		occurredAt: z.string().optional(),
		dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
		assigneeId: z.string().min(1).nullable().optional(),
		companyId: z.string().optional(),
		contactId: z.string().optional(),
		dealId: z.string().optional(),
	})
	.refine((input) => input.companyId || input.contactId || input.dealId, {
		message: "An activity has to be about a company, a contact or a deal.",
	})
	.refine(
		(input) => input.type !== ActivityType.TASK || Boolean(input.subject),
		{
			message: "A task needs a subject — it is the thing to do.",
			path: ["subject"],
		},
	)
	.refine(
		(input) =>
			input.type === ActivityType.TASK || input.assigneeId === undefined,
		{
			message: "Only tasks have an assignee.",
			path: ["assigneeId"],
		},
	);

export type ActivityCreateInput = z.infer<typeof activityCreateInput>;

export const completeInput = z.object({
	id: z.string(),
	completed: z.boolean().default(true),
	expectedVersion: z.number().int().nonnegative().optional(),
});

const taskState = z.object({
	assigneeId: z.string().nullable(),
	assigneeName: z.string().nullable().default(null),
	dueAt: z.string().nullable(),
	completedAt: z.string().nullable(),
});
export const taskIdInput = z.object({ id: z.string().min(1) });
export const taskUpdateInput = z
	.object({
		id: z.string().min(1),
		expectedVersion: z.number().int().nonnegative(),
		dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
		assigneeId: z.string().min(1).nullable().optional(),
	})
	.refine(
		(input) => input.dueAt !== undefined || input.assigneeId !== undefined,
		{ message: "Choose an assignee or deadline to change." },
	);
export type TaskUpdateInput = z.infer<typeof taskUpdateInput>;
export const taskQueueInput = z.object({
	scope: z.enum(["me", "team"]).default("me"),
	status: z.enum(["open", "completed", "all"]).default("open"),
	window: z.enum(["all", "overdue", "upcoming"]).default("all"),
	assigneeId: z.string().min(1).nullable().optional(),
	createdById: z.string().min(1).optional(),
	page: z.number().int().min(0).max(10000).default(0),
	limit: z.number().int().min(1).max(100).default(25),
});
export type TaskQueueInput = z.infer<typeof taskQueueInput>;
export const taskHistoryInput = taskIdInput.extend({
	limit: z.number().int().min(1).max(100).default(50),
});
export const taskHistoryOutput = z.array(
	z.object({
		id: z.string(),
		actor: z.object({ id: z.string(), name: z.string() }),
		action: z.enum(["CREATED", "UPDATED", "COMPLETED", "REOPENED"]),
		before: taskState.nullable(),
		after: taskState,
		taskVersion: z.number().int().nonnegative(),
		createdAt: z.string(),
	}),
);
export type TaskHistoryEntry = z.infer<typeof taskHistoryOutput>[number];

export const myTasksInput = z.object({
	window: z.enum(["overdue", "upcoming", "all"]).default("all"),
	limit: z.number().int().min(1).max(100).default(25),
});

export type MyTasksInput = z.infer<typeof myTasksInput>;

const activityAuthorOutput = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string(),
	image: z.string().nullable(),
});

const activityCompanyRefOutput = z
	.object({
		id: z.string(),
		name: z.string(),
	})
	.nullable();

const activityContactRefOutput = z
	.object({
		id: z.string(),
		firstName: z.string(),
		lastName: z.string().nullable(),
	})
	.nullable();

const activityDealRefOutput = z
	.object({
		id: z.string(),
		name: z.string(),
	})
	.nullable();

const activityEmailThreadOutput = z
	.object({
		id: z.string(),
		messageCount: z.number(),
		lastMessageAt: z.string(),
	})
	.nullable();

const activityCalendarEventOutput = z
	.object({
		id: z.string(),
		startsAt: z.string(),
		endsAt: z.string(),
		isAllDay: z.boolean(),
		location: z.string().nullable(),
		conferenceUrl: z.string().nullable(),
		attendeeCount: z.number(),
	})
	.nullable();

export const activityEntryOutput = z.object({
	id: z.string(),
	type: activityTypeOutput,
	subject: z.string().nullable(),
	body: z.string().nullable(),
	occurredAt: z.string().nullable(),
	dueAt: z.string().nullable(),
	completedAt: z.string().nullable(),
	meta: activityMeta,
	createdAt: z.string(),
	updatedAt: z.string(),
	taskVersion: z.number().int().nonnegative(),
	assignee: activityAuthorOutput.nullable(),
	assigneeActive: z.boolean().nullable(),
	taskPermissions: z
		.object({ canEdit: z.boolean(), canReassign: z.boolean() })
		.nullable(),
	createdBy: activityAuthorOutput,
	company: activityCompanyRefOutput,
	contact: activityContactRefOutput,
	deal: activityDealRefOutput,
	emailThread: activityEmailThreadOutput,
	calendarEvent: activityCalendarEventOutput,
});

export type ActivityEntry = z.infer<typeof activityEntryOutput>;

export const timelineOutput = z.object({
	entries: z.array(activityEntryOutput),
	nextCursor: z.string().nullable(),
});

export type TimelineResult = z.infer<typeof timelineOutput>;

export const timelineCountsOutput = z.object({
	all: z.number(),
	notes: z.number(),
	upcoming: z.number(),
	done: z.number(),
	email: z.number(),
	meetings: z.number(),
});

export type TimelineCounts = z.infer<typeof timelineCountsOutput>;

export const myTasksOutput = z.array(activityEntryOutput);
export const taskQueueOutput = z.object({
	rows: z.array(activityEntryOutput),
	total: z.number().int().nonnegative(),
	counts: z.object({
		open: z.number().int().nonnegative(),
		completed: z.number().int().nonnegative(),
		overdue: z.number().int().nonnegative(),
		unassigned: z.number().int().nonnegative(),
	}),
	viewerRole: z.enum(["owner", "admin", "member"]),
});
export type TaskQueueResult = z.infer<typeof taskQueueOutput>;

export const activityCreateOutput = activityEntryOutput;

export const completeOutput = activityEntryOutput;
