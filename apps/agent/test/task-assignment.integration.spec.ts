import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { db } from "@crm/db";
import { resolveTestDatabase } from "@crm/db/test-database";
import { WORKSPACE_ID } from "@crm/db/workspace";
import { createGovernedRunActivity } from "../agent/lib/governed-run-actions";

const suffix = crypto.randomUUID();
const authorId = `task-agent-author-${suffix}`;
const initiatorId = `task-agent-initiator-${suffix}`;
const memberId = `task-agent-member-${suffix}`;
const runIds: string[] = [];
let companyId = "";
let agentId = "";
let versionId = "";
let createdWorkspace = false;
let trustedDatabase = false;

beforeAll(async () => {
	if (process.env.NODE_ENV !== "test")
		throw new Error("Test environment required");
	resolveTestDatabase(process.env);
	trustedDatabase = true;
	if (!(await db.organization.findUnique({ where: { id: WORKSPACE_ID } }))) {
		await db.organization.create({
			data: {
				id: WORKSPACE_ID,
				name: "Agent task fixture",
				slug: `tasks-${suffix}`,
				createdAt: new Date(),
			},
		});
		createdWorkspace = true;
	}
	await db.user.createMany({
		data: [authorId, initiatorId].map((id) => ({
			id,
			name: id,
			email: `${id}@example.test`,
		})),
	});
	const company = await db.company.create({
		data: { name: `Agent task ${suffix}` },
		select: { id: true },
	});
	companyId = company.id;
	const agent = await db.agentDefinition.create({
		data: {
			name: `Task fixture ${suffix}`,
			status: "LIVE",
			createdById: authorId,
		},
		select: { id: true },
	});
	agentId = agent.id;
	const version = await db.agentVersion.create({
		data: {
			agentId,
			number: 1,
			status: "DEPLOYED",
			instructions: "Create the approved task",
			modelId: "test/model",
			sandboxPolicy: {},
			createdById: authorId,
			approvedAt: new Date(),
			deployedAt: new Date(),
			manifest: {
				triggers: [
					{
						type: "SCHEDULE",
						name: "Fixture",
						summary: "Fixture only",
						config: {
							nextRunAt: new Date().toISOString(),
							intervalMinutes: 60,
						},
					},
				],
				dataScope: {
					mode: "SELECTED",
					summary: "Fixture company only",
					resources: [{ kind: "company", id: companyId, label: "Fixture" }],
				},
				actions: [
					{
						type: "crm.activity.create",
						provider: "crm",
						summary: "Approved task",
						activityTypes: ["TASK", "NOTE"],
					},
					{ type: "run.summary", provider: "crm", summary: "Report" },
				],
			},
		},
		select: { id: true },
	});
	versionId = version.id;
});

beforeEach(async () => {
	if (!trustedDatabase) throw new Error("Fixture database was not established");
	await db.member.deleteMany({
		where: {
			organizationId: WORKSPACE_ID,
			userId: { in: [authorId, initiatorId] },
		},
	});
});

afterAll(async () => {
	if (!trustedDatabase) return;
	const errors: unknown[] = [];
	const cleanup = async (operation: () => Promise<unknown>) => {
		try {
			await operation();
		} catch (error) {
			errors.push(error);
		}
	};
	await cleanup(() =>
		db.taskAuditEvent.deleteMany({
			where: {
				workspaceId: WORKSPACE_ID,
				actorId: { in: [authorId, initiatorId] },
			},
		}),
	);
	for (const runId of runIds) {
		await cleanup(() =>
			db.governedActionAuditEvent.deleteMany({
				where: { workspaceId: WORKSPACE_ID, actorId: `agent-run:${runId}` },
			}),
		);
		await cleanup(() =>
			db.governedActionReceipt.deleteMany({
				where: {
					workspaceId: WORKSPACE_ID,
					idempotencyKey: {
						startsWith: `${WORKSPACE_ID}:crm.activity.create:${runId}:`,
					},
				},
			}),
		);
	}
	if (agentId) {
		await cleanup(() =>
			db.activity.deleteMany({
				where: { meta: { path: ["agentId"], equals: agentId } },
			}),
		);
		await cleanup(() => db.agentAction.deleteMany({ where: { agentId } }));
		await cleanup(() =>
			db.agentRunEvent.deleteMany({ where: { run: { agentId } } }),
		);
		await cleanup(() => db.agentAuditEvent.deleteMany({ where: { agentId } }));
		await cleanup(() => db.agentRun.deleteMany({ where: { agentId } }));
		await cleanup(() => db.agentVersion.deleteMany({ where: { agentId } }));
		await cleanup(() =>
			db.agentDefinition.deleteMany({ where: { id: agentId } }),
		);
	}
	if (companyId)
		await cleanup(() => db.company.deleteMany({ where: { id: companyId } }));
	await cleanup(() =>
		db.user.deleteMany({ where: { id: { in: [authorId, initiatorId] } } }),
	);
	if (createdWorkspace)
		await cleanup(() =>
			db.organization.deleteMany({
				where: { id: WORKSPACE_ID, slug: `tasks-${suffix}` },
			}),
		);
	if (errors.length)
		throw new AggregateError(errors, "Agent task fixture cleanup failed");
});

async function run(initiatedById: string | null = initiatorId) {
	const result = await db.agentRun.create({
		data: {
			agentId,
			versionId,
			initiatedById,
			triggerType: "MANUAL",
			status: "RUNNING",
			startedAt: new Date(),
			idempotencyKey: `agent-task-run-${crypto.randomUUID()}`,
			correlationId: crypto.randomUUID(),
		},
		select: { id: true },
	});
	runIds.push(result.id);
	return result.id;
}

function input(type: "TASK" | "NOTE" = "TASK") {
	return {
		type,
		targetKind: "company" as const,
		targetId: companyId,
		subject: "Next customer step",
		body: "Internal fixture only.",
	};
}

describe("governed task assignment", () => {
	it("assigns the active trusted initiator and replay preserves later human assignment", async () => {
		await db.member.create({
			data: {
				id: memberId,
				organizationId: WORKSPACE_ID,
				userId: initiatorId,
				role: "member",
				createdAt: new Date(),
			},
		});
		const runId = await run();
		const first = await createGovernedRunActivity(runId, "task", input());
		expect(
			await db.activity.findUnique({
				where: { id: first.activityId },
				select: { createdById: true, assigneeId: true },
			}),
		).toEqual({ createdById: initiatorId, assigneeId: initiatorId });
		await db.activity.update({
			where: { id: first.activityId },
			data: { assigneeId: null },
		});
		const replay = await createGovernedRunActivity(runId, "task", input());
		expect(replay).toEqual({ ...first, replayed: true });
		expect(
			(await db.activity.findUniqueOrThrow({ where: { id: first.activityId } }))
				.assigneeId,
		).toBeNull();
		expect(await db.activity.count({ where: { id: first.activityId } })).toBe(
			1,
		);
		expect(
			await db.taskAuditEvent.findMany({
				where: { workspaceId: WORKSPACE_ID, taskId: first.activityId },
				select: { actorId: true, action: true, taskVersion: true, after: true },
			}),
		).toEqual([
			{
				actorId: initiatorId,
				action: "CREATED",
				taskVersion: 0,
				after: {
					assigneeId: initiatorId,
					assigneeName: initiatorId,
					dueAt: null,
					completedAt: null,
				},
			},
		]);
	});

	it("does not assign a revoked principal while preserving immutable authorship", async () => {
		await db.member.create({
			data: {
				id: memberId,
				organizationId: WORKSPACE_ID,
				userId: initiatorId,
				role: "revoked",
				createdAt: new Date(),
			},
		});
		const result = await createGovernedRunActivity(
			await run(),
			"task",
			input(),
		);
		expect(
			await db.activity.findUnique({
				where: { id: result.activityId },
				select: { createdById: true, assigneeId: true },
			}),
		).toEqual({ createdById: initiatorId, assigneeId: null });
	});

	it("keeps a principal without deployment membership unassigned", async () => {
		const result = await createGovernedRunActivity(
			await run(),
			"task",
			input(),
		);
		expect(
			await db.activity.findUnique({
				where: { id: result.activityId },
				select: { createdById: true, assigneeId: true },
			}),
		).toEqual({ createdById: initiatorId, assigneeId: null });
		expect(
			await db.taskAuditEvent.count({
				where: {
					workspaceId: WORKSPACE_ID,
					taskId: result.activityId,
					action: "CREATED",
				},
			}),
		).toBe(1);
	});

	it("scheduled tasks use the active definition author and notes remain unassigned", async () => {
		await db.member.create({
			data: {
				id: `${memberId}-author`,
				organizationId: WORKSPACE_ID,
				userId: authorId,
				role: "admin",
				createdAt: new Date(),
			},
		});
		const runId = await run(null);
		const task = await createGovernedRunActivity(runId, "task", input());
		const note = await createGovernedRunActivity(runId, "note", input("NOTE"));
		expect(
			(await db.activity.findUniqueOrThrow({ where: { id: task.activityId } }))
				.assigneeId,
		).toBe(authorId);
		expect(
			(await db.activity.findUniqueOrThrow({ where: { id: note.activityId } }))
				.assigneeId,
		).toBeNull();
	});

	it("rejects a model-supplied assignee before effects or durable receipts", async () => {
		const runId = await run();
		let failure: unknown;
		try {
			await createGovernedRunActivity(runId, "injected", {
				...input(),
				assigneeId: authorId,
			} as ReturnType<typeof input>);
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeDefined();
		expect(await db.agentAction.count({ where: { runId } })).toBe(0);
		expect(
			await db.activity.count({
				where: { meta: { path: ["runId"], equals: runId } },
			}),
		).toBe(0);
		expect(
			await db.governedActionReceipt.count({
				where: {
					workspaceId: WORKSPACE_ID,
					idempotencyKey: `${WORKSPACE_ID}:crm.activity.create:${runId}:injected`,
				},
			}),
		).toBe(0);
	});
});
