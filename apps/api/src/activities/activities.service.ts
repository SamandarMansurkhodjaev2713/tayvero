import { isWorkspaceRole, WORKSPACE_ID } from "@crm/auth";
import { ActivityType, type Db, Prisma } from "@crm/db";
import { activityMeta } from "@crm/validation/activity-meta";
import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { ActivityStampService } from "../crm/activity-stamp.service";
import { blankToNull } from "../crm/values";
import { InjectDatabase } from "../database/database.constants";
import type {
	ActivityCreateInput,
	ActivityEntry,
	MyTasksInput,
	TaskHistoryEntry,
	TaskQueueInput,
	TaskQueueResult,
	TaskUpdateInput,
	TimelineCounts,
	TimelineFilter,
	TimelineInput,
	TimelineResult,
} from "./activities.contracts";
import { taskHistoryOutput } from "./activities.contracts";
import { type TaskActor, taskPermissions, taskState } from "./task-state";

const AUTHOR_SELECT = {
	id: true,
	name: true,
	email: true,
	image: true,
} as const;

const ENTRY_SELECT = {
	id: true,
	type: true,
	subject: true,
	body: true,
	occurredAt: true,
	dueAt: true,
	completedAt: true,
	meta: true,
	createdAt: true,
	updatedAt: true,
	createdById: true,
	assigneeId: true,
	taskVersion: true,
	createdBy: { select: AUTHOR_SELECT },
	assignee: {
		select: {
			...AUTHOR_SELECT,
			members: {
				where: { organizationId: WORKSPACE_ID },
				select: { role: true },
			},
		},
	},
	company: { select: { id: true, name: true } },
	contact: { select: { id: true, firstName: true, lastName: true } },
	deal: { select: { id: true, name: true } },

	emailThread: {
		select: {
			id: true,
			messageCount: true,
			lastMessageAt: true,
		},
	},
	calendarEvent: {
		select: {
			id: true,
			startsAt: true,
			endsAt: true,
			isAllDay: true,
			location: true,
			conferenceUrl: true,
			_count: { select: { attendees: true } },
		},
	},
} as const;

const NOTE_TYPES = [
	ActivityType.NOTE,
	ActivityType.CALL,
	ActivityType.EMAIL,
	ActivityType.MEETING,
];

@Injectable()
export class ActivitiesService {
	private readonly logger = new Logger(ActivitiesService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly stamp: ActivityStampService,
	) {}

	async timeline(
		input: TimelineInput,
		actingUserId: string,
	): Promise<TimelineResult> {
		const actor = await this.activeMember(this.db, actingUserId);
		const where = this.anchor(input);
		Object.assign(where, filterClause(input.filter));

		const rows = await this.db.activity.findMany({
			where,
			take: input.limit + 1,
			cursor: input.cursor ? { id: input.cursor } : undefined,
			skip: input.cursor ? 1 : undefined,
			orderBy: [
				{ occurredAt: { sort: "desc", nulls: "last" } },
				{ id: "desc" },
			],
			select: ENTRY_SELECT,
		});

		const hasMore = rows.length > input.limit;
		const entries = hasMore ? rows.slice(0, input.limit) : rows;

		return {
			entries: entries.map((entry) => serializeEntry(entry, actor)),
			nextCursor: hasMore ? (entries[entries.length - 1]?.id ?? null) : null,
		};
	}

	async timelineCounts(
		input: Pick<TimelineInput, "companyId" | "contactId" | "dealId">,
	): Promise<TimelineCounts> {
		const anchor = this.anchor(input);

		const [all, notes, upcoming, done, email, meetings] = await Promise.all([
			this.db.activity.count({ where: anchor }),
			this.db.activity.count({
				where: { ...anchor, ...filterClause("notes") },
			}),
			this.db.activity.count({
				where: { ...anchor, ...filterClause("upcoming") },
			}),
			this.db.activity.count({ where: { ...anchor, ...filterClause("done") } }),
			this.db.activity.count({
				where: { ...anchor, ...filterClause("email") },
			}),
			this.db.activity.count({
				where: { ...anchor, ...filterClause("meetings") },
			}),
		]);

		return { all, notes, upcoming, done, email, meetings };
	}

	async create(
		input: ActivityCreateInput,
		actingUserId: string,
	): Promise<ActivityEntry> {
		const isTask = input.type === ActivityType.TASK;

		const activity = await this.db.$transaction(async (tx) => {
			const actor = await this.activeMember(tx, actingUserId, true);
			const companyId = await this.resolveCompanyId(input, tx);
			const assigneeId = isTask
				? input.assigneeId === undefined
					? actingUserId
					: input.assigneeId
				: null;
			if (assigneeId) await this.activeMember(tx, assigneeId, true);
			const created = await tx.activity.create({
				data: {
					type: input.type,
					subject: blankToNull(input.subject ?? ""),
					body: blankToNull(input.body ?? ""),
					occurredAt: parseDate(input.occurredAt) ?? new Date(),
					dueAt: isTask ? parseDate(input.dueAt) : null,
					companyId,
					contactId: input.contactId ?? null,
					dealId: input.dealId ?? null,
					createdById: actingUserId,
					assigneeId,
				},
				select: ENTRY_SELECT,
			});
			if (isTask) await this.auditTask(tx, created, actor, "CREATED", null);
			await this.stamp.touch(
				{ companyId, contactId: input.contactId, dealId: input.dealId },
				created.createdAt,
				tx,
			);
			return { entry: created, actor };
		});

		this.logger.log({
			message: "Activity logged",
			activityId: activity.entry.id,
			type: activity.entry.type,
		});

		return serializeEntry(activity.entry, activity.actor);
	}

	async complete(
		id: string,
		completed: boolean,
		actingUserId: string,
		expectedVersion?: number,
	): Promise<ActivityEntry> {
		return this.db.$transaction(async (tx) => {
			const actor = await this.activeMember(tx, actingUserId, true);
			const before = await this.lockTask(tx, id);
			if (!taskPermissions(before, actor).canEdit)
				throw new ForbiddenException(
					"Only the task author, assignee or an administrator can change this task.",
				);
			// Exact repeat completion remains idempotent, including its original time.
			if (Boolean(before.completedAt) === completed)
				return serializeEntry(before, actor);
			this.assertVersion(before.taskVersion, expectedVersion);
			const after = await tx.activity.update({
				where: { id },
				data: {
					completedAt: completed ? new Date() : null,
					taskVersion: { increment: 1 },
				},
				select: ENTRY_SELECT,
			});
			await this.auditTask(
				tx,
				after,
				actor,
				completed ? "COMPLETED" : "REOPENED",
				before,
			);
			return serializeEntry(after, actor);
		});
	}

	async myTasks(
		input: MyTasksInput,
		actingUserId: string,
	): Promise<ActivityEntry[]> {
		return (
			await this.taskQueue(
				{
					scope: "me",
					status: "open",
					window: input.window,
					page: 0,
					limit: input.limit,
				},
				actingUserId,
			)
		).rows;
	}

	async taskQueue(
		input: TaskQueueInput,
		actingUserId: string,
	): Promise<TaskQueueResult> {
		const now = new Date();
		return this.db.$transaction(
			async (tx) => {
				const actor = await this.activeMember(tx, actingUserId);
				if (
					input.scope === "me" &&
					input.assigneeId !== undefined &&
					input.assigneeId !== actingUserId
				)
					throw new BadRequestException(
						"My queue is restricted to tasks assigned to you.",
					);
				const scoped: Prisma.ActivityWhereInput = {
					type: ActivityType.TASK,
					...(input.scope === "me"
						? { assigneeId: actingUserId }
						: input.assigneeId !== undefined
							? { assigneeId: input.assigneeId }
							: {}),
					...(input.createdById ? { createdById: input.createdById } : {}),
				};
				const where: Prisma.ActivityWhereInput = {
					...scoped,
					...(input.status === "open"
						? { completedAt: null }
						: input.status === "completed"
							? { completedAt: { not: null } }
							: {}),
					...(input.window === "overdue"
						? { dueAt: { lt: now } }
						: input.window === "upcoming"
							? { dueAt: { gte: now } }
							: {}),
				};
				const rows = await tx.activity.findMany({
					where,
					skip: input.page * input.limit,
					take: input.limit,
					orderBy: [
						{ dueAt: { sort: "asc", nulls: "last" } },
						{ createdAt: "desc" },
						{ id: "asc" },
					],
					select: ENTRY_SELECT,
				});
				const total = await tx.activity.count({ where });
				const open = await tx.activity.count({
					where: { ...scoped, completedAt: null },
				});
				const completed = await tx.activity.count({
					where: { ...scoped, completedAt: { not: null } },
				});
				const overdue = await tx.activity.count({
					where: { ...scoped, completedAt: null, dueAt: { lt: now } },
				});
				const unassigned = await tx.activity.count({
					where: { AND: [scoped, { assigneeId: null, completedAt: null }] },
				});
				return {
					rows: rows.map((row) => serializeEntry(row, actor)),
					total,
					counts: { open, completed, overdue, unassigned },
					viewerRole: actor.role,
				};
			},
			{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
		);
	}

	async taskById(id: string, actingUserId: string): Promise<ActivityEntry> {
		const actor = await this.activeMember(this.db, actingUserId);
		const task = await this.db.activity.findUnique({
			where: { id },
			select: ENTRY_SELECT,
		});
		this.assertTask(task, id);
		return serializeEntry(task, actor);
	}

	async taskHistory(
		id: string,
		limit: number,
		actingUserId: string,
	): Promise<TaskHistoryEntry[]> {
		await this.taskById(id, actingUserId);
		const rows = await this.db.taskAuditEvent.findMany({
			where: { workspaceId: WORKSPACE_ID, taskId: id },
			take: limit,
			orderBy: [{ taskVersion: "desc" }, { createdAt: "desc" }, { id: "desc" }],
		});
		return taskHistoryOutput.parse(
			rows.map(({ actorId, actorName, before, after, ...row }) => ({
				...row,
				actor: { id: actorId, name: actorName },
				before,
				after,
				createdAt: row.createdAt.toISOString(),
			})),
		);
	}

	async updateTask(
		input: TaskUpdateInput,
		actingUserId: string,
	): Promise<ActivityEntry> {
		return this.db.$transaction(async (tx) => {
			const actor = await this.activeMember(tx, actingUserId, true);
			const before = await this.lockTask(tx, input.id);
			const permissions = taskPermissions(before, actor);
			if (!permissions.canEdit)
				throw new ForbiddenException(
					"Only the task author, assignee or an administrator can change this task.",
				);
			this.assertVersion(before.taskVersion, input.expectedVersion);
			const assigneeId =
				input.assigneeId === undefined ? before.assigneeId : input.assigneeId;
			const dueAt =
				input.dueAt === undefined ? before.dueAt : parseDate(input.dueAt);
			if (assigneeId !== before.assigneeId && !permissions.canReassign)
				throw new ForbiddenException(
					"Only the task author or an administrator can reassign this task.",
				);
			if (assigneeId !== before.assigneeId && assigneeId)
				await this.activeMember(tx, assigneeId, true);
			if (
				assigneeId === before.assigneeId &&
				dueAt?.getTime() === before.dueAt?.getTime()
			)
				return serializeEntry(before, actor);
			const after = await tx.activity.update({
				where: { id: input.id },
				data: { assigneeId, dueAt, taskVersion: { increment: 1 } },
				select: ENTRY_SELECT,
			});
			await this.auditTask(tx, after, actor, "UPDATED", before);
			return serializeEntry(after, actor);
		});
	}

	private async activeMember(
		client: Db | Prisma.TransactionClient,
		userId: string,
		lock = false,
	): Promise<TaskActor> {
		if (lock) {
			const [row] = await client.$queryRaw<
				Array<{ role: string; name: string }>
			>`SELECT m.role, u.name FROM "member" m JOIN "user" u ON u.id = m."userId" WHERE m."organizationId" = ${WORKSPACE_ID} AND m."userId" = ${userId} FOR SHARE OF m`;
			if (row && isWorkspaceRole(row.role))
				return { id: userId, name: row.name, role: row.role };
		} else {
			const row = await client.member.findUnique({
				where: {
					organizationId_userId: { organizationId: WORKSPACE_ID, userId },
				},
				select: { role: true, user: { select: { name: true } } },
			});
			if (row && isWorkspaceRole(row.role))
				return { id: userId, name: row.user.name, role: row.role };
		}
		throw new ForbiddenException("An active workspace membership is required.");
	}

	private assertTask(task: Entry | null, id: string): asserts task is Entry {
		if (!task) throw new NotFoundException(`No activity with id ${id}.`);
		if (task.type !== ActivityType.TASK)
			throw new BadRequestException("Only tasks can be managed here.");
	}

	private async lockTask(
		tx: Prisma.TransactionClient,
		id: string,
	): Promise<Entry> {
		await tx.$queryRaw`SELECT id FROM activity WHERE id = ${id} FOR UPDATE`;
		const task = await tx.activity.findUnique({
			where: { id },
			select: ENTRY_SELECT,
		});
		this.assertTask(task, id);
		return task;
	}

	private assertVersion(actual: number, expected?: number) {
		if (expected !== undefined && actual !== expected)
			throw new ConflictException(
				"This task changed. Reload it before saving.",
			);
	}

	private async auditTask(
		tx: Prisma.TransactionClient,
		task: Entry,
		actor: TaskActor,
		action: "CREATED" | "UPDATED" | "COMPLETED" | "REOPENED",
		before: Entry | null,
	) {
		await tx.taskAuditEvent.create({
			data: {
				workspaceId: WORKSPACE_ID,
				taskId: task.id,
				actorId: actor.id,
				actorName: actor.name,
				action,
				before: before ? taskState(before) : Prisma.DbNull,
				after: taskState(task),
				taskVersion: task.taskVersion,
			},
		});
	}

	private anchor(
		input: Pick<TimelineInput, "companyId" | "contactId" | "dealId">,
	): Prisma.ActivityWhereInput {
		if (input.dealId) return { dealId: input.dealId };
		if (input.contactId) return { contactId: input.contactId };
		if (input.companyId) return { companyId: input.companyId };
		throw new BadRequestException(
			"A timeline needs a company, a contact or a deal.",
		);
	}

	private async resolveCompanyId(
		input: ActivityCreateInput,
		client: Prisma.TransactionClient,
	): Promise<string | null> {
		let companyId: string | null | undefined = input.companyId;
		if (
			input.companyId &&
			!(await client.company.findUnique({
				where: { id: input.companyId },
				select: { id: true },
			}))
		)
			throw new NotFoundException(`No company with id ${input.companyId}.`);
		if (input.dealId) {
			const deal = await client.deal.findUnique({
				where: { id: input.dealId },
				select: { companyId: true },
			});
			if (!deal) {
				throw new NotFoundException(`No deal with id ${input.dealId}.`);
			}
			if (companyId !== undefined && companyId !== deal.companyId)
				throw new BadRequestException(
					"The activity company and deal must belong together.",
				);
			companyId = deal.companyId;
		}

		if (input.contactId) {
			const contact = await client.contact.findUnique({
				where: { id: input.contactId },
				select: { companyId: true },
			});
			if (!contact) {
				throw new NotFoundException(`No contact with id ${input.contactId}.`);
			}
			if (companyId !== undefined && companyId !== contact.companyId)
				throw new BadRequestException(
					"The activity company, contact and deal must belong together.",
				);
			companyId = contact.companyId;
		}

		return companyId ?? null;
	}
}

function filterClause(filter: TimelineFilter): Prisma.ActivityWhereInput {
	switch (filter) {
		case "notes":
			return { type: { in: NOTE_TYPES } };
		case "upcoming":
			return { type: ActivityType.TASK, completedAt: null };
		case "done":
			return { type: ActivityType.TASK, completedAt: { not: null } };
		case "history":
			return { NOT: { type: ActivityType.TASK, completedAt: null } };
		case "email":
			return { type: ActivityType.EMAIL };
		case "meetings":
			return { type: ActivityType.MEETING };
		case "all":
			return {};
	}
}

type Entry = Prisma.ActivityGetPayload<{ select: typeof ENTRY_SELECT }>;

function serializeEntry(entry: Entry, actor: TaskActor): ActivityEntry {
	const assignee = entry.assignee
		? {
				id: entry.assignee.id,
				name: entry.assignee.name,
				email: entry.assignee.email,
				image: entry.assignee.image,
			}
		: null;
	return {
		...entry,
		occurredAt: entry.occurredAt?.toISOString() ?? null,
		dueAt: entry.dueAt?.toISOString() ?? null,
		completedAt: entry.completedAt?.toISOString() ?? null,
		createdAt: entry.createdAt.toISOString(),
		updatedAt: entry.updatedAt.toISOString(),
		assignee,
		assigneeActive:
			entry.type === ActivityType.TASK && entry.assignee
				? entry.assignee.members.some((member) => isWorkspaceRole(member.role))
				: null,
		taskPermissions:
			entry.type === ActivityType.TASK ? taskPermissions(entry, actor) : null,
		meta: activityMeta.parse(entry.meta),

		emailThread: entry.emailThread
			? {
					id: entry.emailThread.id,
					messageCount: entry.emailThread.messageCount,
					lastMessageAt: entry.emailThread.lastMessageAt.toISOString(),
				}
			: null,

		calendarEvent: entry.calendarEvent
			? {
					id: entry.calendarEvent.id,
					startsAt: entry.calendarEvent.startsAt.toISOString(),
					endsAt: entry.calendarEvent.endsAt.toISOString(),
					isAllDay: entry.calendarEvent.isAllDay,
					location: entry.calendarEvent.location,
					conferenceUrl: entry.calendarEvent.conferenceUrl,
					attendeeCount: entry.calendarEvent._count.attendees,
				}
			: null,
	};
}

function parseDate(value: string | null | undefined): Date | null {
	if (value === null || value === undefined || value === "") return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new BadRequestException(`"${value}" is not a date.`);
	}
	return date;
}
