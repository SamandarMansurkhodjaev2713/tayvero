import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { WORKSPACE_ID } from "@crm/auth";
import { db } from "@crm/db";
import { resolveTestDatabase } from "@crm/db/test-database";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type {
	ActivityEntry,
	TaskQueueResult,
} from "../src/activities/activities.contracts";
import { createApp } from "../src/create-app";
import {
	type SignedSessionFixture,
	signedSessionFixture,
} from "./fixtures/signed-session";

describe("team task ownership through production signed HTTP auth and PostgreSQL", () => {
	const fixtureId = `team-tasks-${randomUUID()}`;
	const seats: SignedSessionFixture[] = [];
	let author: SignedSessionFixture;
	let assignee: SignedSessionFixture;
	let unrelated: SignedSessionFixture;
	let admin: SignedSessionFixture;
	let revoked: SignedSessionFixture;
	let app: NestExpressApplication | undefined;
	let bridgeSecret: string | undefined;
	let trustedDatabase = false;
	let createdWorkspace = false;
	let companyId: string | undefined;
	let foreignWorkspace: string | undefined;
	const ownTasks = () => ({ companyId: companyId ?? fixtureId });
	const server = () => {
		if (!app) throw new Error("Fixture app unavailable");
		return app.getHttpServer();
	};
	const create = async (seat = author, patch: Record<string, unknown> = {}) => {
		const response = await request(server())
			.post("/rest/activities")
			.set("Cookie", seat.cookie)
			.send({ type: "TASK", subject: "Fixture follow-up", companyId, ...patch })
			.expect(200);
		return response.body as ActivityEntry;
	};
	const queue = async (
		seat: SignedSessionFixture,
		patch: Record<string, unknown> = {},
	) => {
		const response = await request(server())
			.post("/rest/tasks/search")
			.set("Cookie", seat.cookie)
			.send({
				scope: "team",
				createdById: author.user.id,
				status: "all",
				...patch,
			})
			.expect(200);
		return response.body as TaskQueueResult;
	};
	const history = async (id: string) =>
		(
			await request(server())
				.get(`/rest/tasks/${id}/history`)
				.set("Cookie", author.cookie)
				.expect(200)
		).body as Array<{
			taskVersion: number;
			action: string;
			before: { assigneeName: string | null } | null;
			after: { assigneeName: string | null; assigneeId: string | null };
		}>;

	beforeAll(async () => {
		bridgeSecret = process.env.AGENT_BRIDGE_SECRET;
		if (process.env.NODE_ENV !== "test")
			throw new Error("Team fixtures require NODE_ENV=test");
		resolveTestDatabase(process.env);
		trustedDatabase = true;
		const workspace = await db.organization.findUnique({
			where: { id: WORKSPACE_ID },
		});
		if (!workspace) {
			await db.organization.create({
				data: {
					id: WORKSPACE_ID,
					name: fixtureId,
					slug: fixtureId,
					createdAt: new Date(),
				},
			});
			createdWorkspace = true;
		}
		for (const role of [
			"member",
			"member",
			"member",
			"admin",
			"member",
		] as const)
			seats.push(await signedSessionFixture(role));
		[author, assignee, unrelated, admin, revoked] = seats as [
			SignedSessionFixture,
			SignedSessionFixture,
			SignedSessionFixture,
			SignedSessionFixture,
			SignedSessionFixture,
		];
		companyId = (
			await db.company.create({
				data: { name: fixtureId, ownerId: author.user.id },
			})
		).id;
		await revoked.revoke();
		foreignWorkspace = `${fixtureId}-foreign`;
		await db.organization.create({
			data: {
				id: foreignWorkspace,
				name: "Foreign fixture",
				slug: foreignWorkspace,
				createdAt: new Date(),
			},
		});
		await db.member.create({
			data: {
				id: `${fixtureId}-foreign-seat`,
				organizationId: foreignWorkspace,
				userId: revoked.user.id,
				role: "member",
				createdAt: new Date(),
			},
		});
		delete process.env.AGENT_BRIDGE_SECRET;
		app = await createApp();
	}, 30_000);

	afterAll(async () => {
		const errors: unknown[] = [];
		const attempt = async (action: () => unknown) => {
			try {
				await action();
			} catch (error) {
				errors.push(error);
			}
		};
		try {
			await attempt(() => app?.close());
		} finally {
			if (bridgeSecret === undefined) delete process.env.AGENT_BRIDGE_SECRET;
			else process.env.AGENT_BRIDGE_SECRET = bridgeSecret;
		}
		if (trustedDatabase) {
			await attempt(() =>
				db.taskAuditEvent.deleteMany({
					where: {
						workspaceId: WORKSPACE_ID,
						actorId: { in: seats.map((seat) => seat.user.id) },
					},
				}),
			);
			await attempt(() => db.activity.deleteMany({ where: ownTasks() }));
			if (companyId)
				await attempt(() => db.company.delete({ where: { id: companyId } }));
			for (const seat of seats) await attempt(() => seat.cleanup());
			if (foreignWorkspace)
				await attempt(() =>
					db.organization.delete({ where: { id: foreignWorkspace } }),
				);
			if (createdWorkspace)
				await attempt(() =>
					db.organization.delete({ where: { id: WORKSPACE_ID } }),
				);
		}
		if (errors.length)
			throw new AggregateError(errors, "Team fixture cleanup failed");
	});

	it("keeps creator immutable and places assigned tasks in the recipient queue and scoped dashboard", async () => {
		const task = await create(author, {
			assigneeId: assignee.user.id,
			dueAt: "2020-01-01T00:00:00Z",
		});
		expect(task.createdBy.id).toBe(author.user.id);
		expect(task.assignee?.id).toBe(assignee.user.id);
		expect(task.assigneeActive).toBe(true);
		const recipient = await queue(assignee, { scope: "me" });
		expect(recipient.rows.map((row) => row.id)).toContain(task.id);
		expect(
			(await queue(author, { scope: "me" })).rows.map((row) => row.id),
		).not.toContain(task.id);
		for (const [seat, scope, contains] of [
			[assignee, "me", true],
			[author, "me", false],
			[author, "everyone", true],
		] as const) {
			const dashboard = await request(server())
				.get("/rest/dashboard/summary")
				.query({ scope })
				.set("Cookie", seat.cookie)
				.expect(200);
			expect(
				dashboard.body.overdueTasks.some(
					(row: { id: string }) => row.id === task.id,
				),
			).toBe(contains);
		}
		expect((await history(task.id))[0]?.after).toMatchObject({
			assigneeId: assignee.user.id,
			assigneeName: assignee.user.name,
		});
	});

	it("distinguishes omitted self assignment from explicit unassigned and direct legacy inserts", async () => {
		const self = await create();
		const unassigned = await create(author, { assigneeId: null });
		const legacy = await db.activity.create({
			data: {
				type: "TASK",
				subject: "Legacy direct insert",
				companyId,
				createdById: author.user.id,
			},
		});
		expect(self.assignee?.id).toBe(author.user.id);
		expect(unassigned.assignee).toBeNull();
		expect(
			(await queue(author, { scope: "me" })).rows.map((row) => row.id),
		).not.toContain(legacy.id);
		const team = await queue(author, { assigneeId: null });
		expect(team.rows.map((row) => row.id)).toContain(legacy.id);
		expect(team.rows.map((row) => row.id)).toContain(unassigned.id);
		expect(team.counts.unassigned).toBe(2);
	});

	it("rejects revoked/foreign/nonmember assignees and revoked actors without writes", async () => {
		const before = await db.activity.count({ where: ownTasks() });
		const nonmember = await signedSessionFixture("member");
		seats.push(nonmember);
		await nonmember.revoke();
		for (const target of [
			revoked.user.id,
			nonmember.user.id,
			`absent-${fixtureId}`,
		])
			await request(server())
				.post("/rest/activities")
				.set("Cookie", author.cookie)
				.send({
					type: "TASK",
					subject: "Denied",
					companyId,
					assigneeId: target,
				})
				.expect(403);
		await request(server())
			.post("/rest/activities")
			.set("Cookie", revoked.cookie)
			.send({ type: "TASK", subject: "Denied actor", companyId })
			.expect(403);
		await request(server())
			.post("/rest/tasks/search")
			.set("Cookie", revoked.cookie)
			.send({ scope: "team" })
			.expect(403);
		expect(await db.activity.count({ where: ownTasks() })).toBe(before);
	});

	it("reports actual revoked assignment and retains historical names after member rename", async () => {
		const recipient = await signedSessionFixture("member");
		seats.push(recipient);
		const task = await create(author, { assigneeId: recipient.user.id });
		await db.user.update({
			where: { id: recipient.user.id },
			data: { name: "Renamed fixture" },
		});
		await recipient.revoke();
		const read = await request(server())
			.get(`/rest/tasks/${task.id}`)
			.set("Cookie", author.cookie)
			.expect(200);
		expect(read.body.assignee.name).toBe("Renamed fixture");
		expect(read.body.assigneeActive).toBe(false);
		expect((await history(task.id))[0]?.after.assigneeName).toBe(
			recipient.user.name,
		);
		await request(server())
			.patch(`/rest/activities/${task.id}/complete`)
			.set("Cookie", recipient.cookie)
			.send({ completed: true })
			.expect(403);
	});

	it("enforces edit and reassignment permissions server-side with active recipient checks", async () => {
		const task = await create(author, { assigneeId: assignee.user.id });
		for (const mutation of [{ dueAt: null }, { assigneeId: unrelated.user.id }])
			await request(server())
				.patch(`/rest/tasks/${task.id}`)
				.set("Cookie", unrelated.cookie)
				.send({ expectedVersion: 0, ...mutation })
				.expect(403);
		await request(server())
			.patch(`/rest/activities/${task.id}/complete`)
			.set("Cookie", unrelated.cookie)
			.send({ completed: true, expectedVersion: 0 })
			.expect(403);
		await request(server())
			.patch(`/rest/tasks/${task.id}`)
			.set("Cookie", assignee.cookie)
			.send({ expectedVersion: 0, assigneeId: unrelated.user.id })
			.expect(403);
		await request(server())
			.patch(`/rest/tasks/${task.id}`)
			.set("Cookie", author.cookie)
			.send({ expectedVersion: 0, assigneeId: revoked.user.id })
			.expect(403);
		const updated = await request(server())
			.patch(`/rest/tasks/${task.id}`)
			.set("Cookie", assignee.cookie)
			.send({ expectedVersion: 0, dueAt: "2030-01-01T00:00:00+05:00" })
			.expect(200);
		expect(updated.body.dueAt).toBe("2029-12-31T19:00:00.000Z");
		expect(updated.body.createdBy.id).toBe(author.user.id);
		await request(server())
			.patch(`/rest/tasks/${task.id}`)
			.set("Cookie", admin.cookie)
			.send({ expectedVersion: 1, assigneeId: unrelated.user.id })
			.expect(200);
		expect((await history(task.id)).map((entry) => entry.taskVersion)).toEqual([
			2, 1, 0,
		]);
	});

	it("preserves omitted dates, clears explicit null, rejects ambiguous dates and exposes missing records", async () => {
		const task = await create(author, { dueAt: "2030-03-01T00:00:00Z" });
		for (const dueAt of ["2030-03-01", "2030-03-01T00:00:00", "invalid"])
			for (const method of ["create", "update"] as const) {
				const call =
					method === "create"
						? request(server())
								.post("/rest/activities")
								.send({ type: "TASK", subject: "Invalid", companyId, dueAt })
						: request(server())
								.patch(`/rest/tasks/${task.id}`)
								.send({ expectedVersion: 0, dueAt });
				await call.set("Cookie", author.cookie).expect(400);
			}
		const changed = await request(server())
			.patch(`/rest/tasks/${task.id}`)
			.set("Cookie", author.cookie)
			.send({ expectedVersion: 0, assigneeId: assignee.user.id })
			.expect(200);
		expect(changed.body.dueAt).toBe(task.dueAt);
		await request(server())
			.patch(`/rest/tasks/${task.id}`)
			.set("Cookie", author.cookie)
			.send({ expectedVersion: 1, dueAt: null })
			.expect(200);
		await request(server())
			.get(`/rest/tasks/missing-${fixtureId}`)
			.set("Cookie", author.cookie)
			.expect(404);
		const note = await request(server())
			.post("/rest/activities")
			.set("Cookie", author.cookie)
			.send({ type: "NOTE", body: "Fixture note", companyId })
			.expect(200);
		expect(note.body.taskPermissions).toBeNull();
		await request(server())
			.get(`/rest/tasks/${note.body.id}`)
			.set("Cookie", author.cookie)
			.expect(400);
	});

	it("serializes competing same-version writes and orders history by causal version", async () => {
		const task = await create();
		const results = await Promise.all(
			[assignee, unrelated].map((seat) =>
				request(server())
					.patch(`/rest/tasks/${task.id}`)
					.set("Cookie", author.cookie)
					.send({ expectedVersion: 0, assigneeId: seat.user.id }),
			),
		);
		expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
		const accepted = results.find((result) => result.status === 200);
		const stored = await db.activity.findUniqueOrThrow({
			where: { id: task.id },
		});
		expect(stored.assigneeId).toBe(accepted?.body.assignee.id);
		expect(stored.taskVersion).toBe(1);
		expect((await history(task.id)).map((entry) => entry.taskVersion)).toEqual([
			1, 0,
		]);
		const changes = await Promise.all([
			request(server())
				.patch(`/rest/tasks/${task.id}`)
				.set("Cookie", author.cookie)
				.send({ expectedVersion: 1, dueAt: "2031-01-01T00:00:00Z" }),
			request(server())
				.patch(`/rest/activities/${task.id}/complete`)
				.set("Cookie", author.cookie)
				.send({ expectedVersion: 1, completed: true }),
		]);
		expect(changes.map((result) => result.status).sort()).toEqual([200, 409]);
		const winner = changes.find((result) => result.status === 200)?.body;
		const after = await db.activity.findUniqueOrThrow({
			where: { id: task.id },
		});
		expect(after.dueAt?.toISOString() ?? null).toBe(winner.dueAt);
		expect(after.completedAt?.toISOString() ?? null).toBe(winner.completedAt);
		expect(after.taskVersion).toBe(2);
	});

	it("keeps repeated completion idempotent and records reopen/complete actors", async () => {
		const task = await create(author, { assigneeId: assignee.user.id });
		const complete = await request(server())
			.patch(`/rest/activities/${task.id}/complete`)
			.set("Cookie", assignee.cookie)
			.send({ expectedVersion: 0, completed: true })
			.expect(200);
		const duplicate = await request(server())
			.patch(`/rest/activities/${task.id}/complete`)
			.set("Cookie", assignee.cookie)
			.send({ expectedVersion: 0, completed: true })
			.expect(200);
		expect(duplicate.body.completedAt).toBe(complete.body.completedAt);
		expect(duplicate.body.taskVersion).toBe(1);
		expect(
			await db.taskAuditEvent.count({
				where: { workspaceId: WORKSPACE_ID, taskId: task.id },
			}),
		).toBe(2);
		await request(server())
			.patch(`/rest/activities/${task.id}/complete`)
			.set("Cookie", author.cookie)
			.send({ expectedVersion: 1, completed: false })
			.expect(200);
		await request(server())
			.patch(`/rest/activities/${task.id}/complete`)
			.set("Cookie", admin.cookie)
			.send({ expectedVersion: 2, completed: true })
			.expect(200);
		const events = await db.taskAuditEvent.findMany({
			where: { workspaceId: WORKSPACE_ID, taskId: task.id },
			orderBy: { taskVersion: "asc" },
		});
		expect(events.map((event) => event.actorId)).toEqual([
			author.user.id,
			assignee.user.id,
			author.user.id,
			admin.user.id,
		]);
		expect(events.map((event) => event.action)).toEqual([
			"CREATED",
			"COMPLETED",
			"REOPENED",
			"COMPLETED",
		]);
	});

	it("returns all equally dated rows once across pages, applies filters before limit and retains undated rows", async () => {
		const time = new Date("2040-01-01T00:00:00Z");
		await db.activity.createMany({
			data: Array.from({ length: 105 }, (_, index) => ({
				id: `${fixtureId}-page-${index.toString().padStart(3, "0")}`,
				type: "TASK" as const,
				subject: "Page fixture",
				companyId,
				createdById: unrelated.user.id,
				assigneeId: assignee.user.id,
				createdAt: time,
				dueAt: time,
			})),
		});
		const undated = await db.activity.create({
			data: {
				type: "TASK",
				subject: "Undated",
				companyId,
				createdById: unrelated.user.id,
				assigneeId: assignee.user.id,
			},
		});
		const ids: string[] = [];
		for (let page = 0; page < 5; page++) {
			const result = await queue(author, {
				createdById: unrelated.user.id,
				assigneeId: assignee.user.id,
				limit: 25,
				page,
			});
			expect(result.total).toBe(106);
			expect(result.counts.open).toBe(106);
			ids.push(...result.rows.map((row) => row.id));
		}
		expect(ids.length).toBe(106);
		expect(new Set(ids).size).toBe(106);
		expect(ids.at(-1)).toBe(undated.id);
		const filtered = await queue(author, {
			createdById: unrelated.user.id,
			assigneeId: null,
			limit: 1,
		});
		expect(filtered.total).toBe(0);
		expect(filtered.rows).toEqual([]);
	});

	it("rolls back create and edits when the real database rejects their audit insert", async () => {
		const task = await create();
		const count = await db.activity.count({ where: ownTasks() });
		const audits = await db.taskAuditEvent.count({
			where: { workspaceId: WORKSPACE_ID, actorId: author.user.id },
		});
		const suffix = randomUUID().replaceAll("-", "");
		const fn = `test_task_audit_${suffix}`;
		const trigger = `test_task_audit_trigger_${suffix}`;
		await db.$executeRawUnsafe(
			`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."actorId" = TG_ARGV[0] THEN RAISE EXCEPTION 'fixture audit refusal'; END IF; RETURN NEW; END $$`,
		);
		try {
			await db.$executeRawUnsafe(
				`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "taskAuditEvent" FOR EACH ROW EXECUTE FUNCTION "${fn}"('${author.user.id}')`,
			);
			await request(server())
				.post("/rest/activities")
				.set("Cookie", author.cookie)
				.send({ type: "TASK", subject: "Must roll back", companyId })
				.expect(500);
			await request(server())
				.patch(`/rest/tasks/${task.id}`)
				.set("Cookie", author.cookie)
				.send({ expectedVersion: 0, dueAt: "2030-01-01T00:00:00Z" })
				.expect(500);
			expect(await db.activity.count({ where: ownTasks() })).toBe(count);
			expect(
				await db.taskAuditEvent.count({
					where: { workspaceId: WORKSPACE_ID, actorId: author.user.id },
				}),
			).toBe(audits);
			const unchanged = await db.activity.findUniqueOrThrow({
				where: { id: task.id },
			});
			expect(unchanged.taskVersion).toBe(0);
			expect(unchanged.dueAt).toBeNull();
		} finally {
			try {
				await db.$executeRawUnsafe(
					`DROP TRIGGER IF EXISTS "${trigger}" ON "taskAuditEvent"`,
				);
			} finally {
				await db.$executeRawUnsafe(`DROP FUNCTION "${fn}"()`);
			}
		}
	});

	it("rolls back the task and audit when its activity stamp fails", async () => {
		const before = await db.activity.count({ where: ownTasks() });
		const audits = await db.taskAuditEvent.count({
			where: { workspaceId: WORKSPACE_ID, actorId: author.user.id },
		});
		const suffix = randomUUID().replaceAll("-", "");
		const fn = `test_task_stamp_${suffix}`;
		const trigger = `test_task_stamp_trigger_${suffix}`;
		await db.$executeRawUnsafe(
			`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = TG_ARGV[0] THEN RAISE EXCEPTION 'fixture stamp refusal'; END IF; RETURN NEW; END $$`,
		);
		try {
			await db.$executeRawUnsafe(
				`CREATE TRIGGER "${trigger}" BEFORE UPDATE OF "lastActivityAt" ON company FOR EACH ROW EXECUTE FUNCTION "${fn}"('${companyId}')`,
			);
			await request(server())
				.post("/rest/activities")
				.set("Cookie", author.cookie)
				.send({ type: "TASK", subject: "Stamp must roll back", companyId })
				.expect(500);
			expect(await db.activity.count({ where: ownTasks() })).toBe(before);
			expect(
				await db.taskAuditEvent.count({
					where: { workspaceId: WORKSPACE_ID, actorId: author.user.id },
				}),
			).toBe(audits);
		} finally {
			try {
				await db.$executeRawUnsafe(
					`DROP TRIGGER IF EXISTS "${trigger}" ON company`,
				);
			} finally {
				await db.$executeRawUnsafe(`DROP FUNCTION "${fn}"()`);
			}
		}
	});

	it("rejects contradictory CRM anchors and accepts matching company/contact/deal links", async () => {
		const foreign = await db.company.create({
			data: { name: `${fixtureId}-other`, ownerId: author.user.id },
		});
		let contactId: string | undefined;
		let dealId: string | undefined;
		try {
			contactId = (
				await db.contact.create({
					data: { firstName: "Linked fixture", companyId: foreign.id },
				})
			).id;
			dealId = (
				await db.deal.create({
					data: {
						name: "Linked fixture",
						companyId: foreign.id,
						ownerId: author.user.id,
					},
				})
			).id;
			const before = await db.activity.count({
				where: { createdById: author.user.id },
			});
			for (const patch of [{ contactId }, { dealId }, { contactId, dealId }])
				await request(server())
					.post("/rest/activities")
					.set("Cookie", author.cookie)
					.send({ type: "TASK", subject: "Contradictory", companyId, ...patch })
					.expect(400);
			expect(
				await db.activity.count({ where: { createdById: author.user.id } }),
			).toBe(before);
			const valid = await create(author, {
				companyId: foreign.id,
				contactId,
				dealId,
			});
			expect(valid.company?.id).toBe(foreign.id);
			expect(valid.contact?.id).toBe(contactId);
			expect(valid.deal?.id).toBe(dealId);
			await db.taskAuditEvent.deleteMany({
				where: { workspaceId: WORKSPACE_ID, taskId: valid.id },
			});
		} finally {
			await db.activity.deleteMany({ where: { companyId: foreign.id } });
			if (dealId) await db.deal.delete({ where: { id: dealId } });
			if (contactId) await db.contact.delete({ where: { id: contactId } });
			await db.company.delete({ where: { id: foreign.id } });
		}
	});
});
