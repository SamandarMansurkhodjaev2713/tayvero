import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { WORKSPACE_ID } from "@crm/auth";
import { db } from "@crm/db";
import { resolveTestDatabase } from "@crm/db/test-database";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { AgentTriggerService } from "../src/agent/agent-trigger.service";
import { FaviconService } from "../src/companies/favicon.service";
import { createApp } from "../src/create-app";
import { FieldsService } from "../src/fields/fields.service";
import { WorkspaceService } from "../src/workspace/workspace.service";
import { signedSessionFixture } from "./fixtures/signed-session";

describe("real signed sessions and optional workspace onboarding (HTTP/PostgreSQL)", () => {
	let app: NestExpressApplication;
	let snapshot: Awaited<ReturnType<typeof db.organization.findUnique>>;
	const seats: Awaited<ReturnType<typeof signedSessionFixture>>[] = [];
	let owner: (typeof seats)[number];
	let admin: (typeof seats)[number];
	let member: (typeof seats)[number];
	let revoked: (typeof seats)[number];
	let expired: (typeof seats)[number];
	const companyIds: string[] = [];
	const contactIds: string[] = [];
	const dealIds: string[] = [];
	const activityIds: string[] = [];
	const restoreEffects: Array<() => void> = [];
	let bridgeSecret: string | undefined;
	let trustedTestDatabaseEstablished = false;
	let workspaceSnapshotRead = false;
	let workspaceCreatedBySuite = false;

	beforeAll(async () => {
		bridgeSecret = process.env.AGENT_BRIDGE_SECRET;
		if (process.env.NODE_ENV !== "test")
			throw new Error("HTTP fixtures require NODE_ENV=test.");
		resolveTestDatabase(process.env);
		trustedTestDatabaseEstablished = true;
		snapshot = await db.organization.findUnique({
			where: { id: WORKSPACE_ID },
		});
		workspaceSnapshotRead = true;
		if (!snapshot) {
			await db.organization.create({
				data: {
					id: WORKSPACE_ID,
					name: "HTTP fixture",
					slug: "http-fixture",
					createdAt: new Date(),
				},
			});
			workspaceCreatedBySuite = true;
		}
		owner = await signedSessionFixture("owner");
		seats.push(owner);
		admin = await signedSessionFixture("admin");
		seats.push(admin);
		member = await signedSessionFixture("member");
		seats.push(member);
		revoked = await signedSessionFixture("member");
		seats.push(revoked);
		expired = await signedSessionFixture(
			"member",
			new Date(Date.now() - 60_000),
		);
		seats.push(expired);
		// Exercise the supported installation without an agent bridge; this also
		// prevents bootstrap heartbeat transport before createApp returns.
		delete process.env.AGENT_BRIDGE_SECRET;
		app = await createApp();
		// Only provider/dispatch boundaries are replaced; auth, transactions, durable
		// event receipts, validation and all CRUD services remain the real instances.
		const agent = app.get(AgentTriggerService);
		const pokeDescriptor = Object.getOwnPropertyDescriptor(agent, "poke");
		Object.defineProperty(agent, "poke", {
			configurable: true,
			value: () => {},
		});
		restoreEffects.push(() => {
			if (pokeDescriptor) Object.defineProperty(agent, "poke", pokeDescriptor);
			else Reflect.deleteProperty(agent, "poke");
		});
		for (const effect of [
			spyOn(agent, "companyCreated").mockResolvedValue(undefined),
			spyOn(agent, "contactCreated").mockResolvedValue(false),
			spyOn(app.get(FaviconService), "backfill").mockResolvedValue(false),
			spyOn(
				app.get(FieldsService),
				"queueBackfillForNewRecord",
			).mockResolvedValue(undefined),
		])
			restoreEffects.push(() => effect.mockRestore());
	}, 30_000);

	afterAll(async () => {
		const failures: unknown[] = [];
		const cleanup = async (action: () => unknown) => {
			try {
				await action();
			} catch (error) {
				failures.push(error);
			}
		};
		try {
			await cleanup(() => app?.close());
		} finally {
			for (const restore of restoreEffects.reverse()) await cleanup(restore);
			if (bridgeSecret === undefined) delete process.env.AGENT_BRIDGE_SECRET;
			else process.env.AGENT_BRIDGE_SECRET = bridgeSecret;
		}
		if (!trustedTestDatabaseEstablished) {
			if (failures.length)
				throw new AggregateError(
					failures,
					"HTTP fixture teardown failed before test database selection.",
				);
			return;
		}
		await cleanup(() =>
			db.agentTask.deleteMany({
				where: {
					OR: [
						{ companyId: { in: companyIds } },
						{ contactId: { in: contactIds } },
						{ dealId: { in: dealIds } },
					],
				},
			}),
		);
		await cleanup(() =>
			db.activity.deleteMany({ where: { id: { in: activityIds } } }),
		);
		await cleanup(() => db.deal.deleteMany({ where: { id: { in: dealIds } } }));
		await cleanup(() =>
			db.contact.deleteMany({ where: { id: { in: contactIds } } }),
		);
		await cleanup(() =>
			db.company.deleteMany({
				where: {
					OR: [
						{ id: { in: companyIds } },
						...(member ? [{ name: `Journey ${member.user.id}` }] : []),
					],
				},
			}),
		);
		for (const seat of seats) await cleanup(() => seat.cleanup());
		if (workspaceSnapshotRead && snapshot) {
			const original = snapshot;
			await cleanup(() =>
				db.organization.update({
					where: { id: WORKSPACE_ID },
					data: {
						name: original.name,
						slug: original.slug,
						website: original.website,
						metadata: original.metadata,
					},
				}),
			);
		} else if (workspaceCreatedBySuite) {
			await cleanup(() =>
				db.organization.delete({ where: { id: WORKSPACE_ID } }),
			);
		}
		if (failures.length)
			throw new AggregateError(failures, "HTTP fixture cleanup failed.");
	});

	it("cleans a partially created session fixture when later setup fails", async () => {
		const before = await db.user.count({
			where: { id: { startsWith: "http-role-" } },
		});
		let refusal: unknown;
		try {
			await signedSessionFixture("member", undefined, () => {
				throw new Error("fixture session setup refused");
			});
		} catch (error) {
			refusal = error;
		}
		expect(refusal).toMatchObject({ message: "fixture session setup refused" });
		expect(
			await db.user.count({ where: { id: { startsWith: "http-role-" } } }),
		).toBe(before);
	});

	it("accepts the actual auth cookie for owner, admin and member with correct capabilities", async () => {
		for (const [seat, role, canRename] of [
			[owner, "owner", true],
			[admin, "admin", true],
			[member, "member", false],
		] as const) {
			const identity = await request(app.getHttpServer())
				.get("/auth/me")
				.set("Cookie", seat.cookie)
				.expect(200);
			expect(identity.body.user.id).toBe(seat.user.id);
			const workspace = await request(app.getHttpServer())
				.get("/rest/workspace")
				.set("Cookie", seat.cookie)
				.expect(200);
			expect(workspace.body.viewerRole).toBe(role);
			expect(workspace.body.canRename).toBe(canRename);
		}
	});

	it("onboards owner/admin without a website or provider research key", async () => {
		for (const seat of [owner, admin]) {
			const response = await request(app.getHttpServer())
				.patch("/rest/workspace")
				.set("Cookie", seat.cookie)
				.send({ name: "HTTP fixture", website: "" })
				.expect(200);
			expect(response.body.website).toBeNull();
			expect(response.body.onboarded).toBe(true);
		}
	});

	it("denies a member mutation and malformed nonempty website before persistence", async () => {
		const before = await db.organization.findUniqueOrThrow({
			where: { id: WORKSPACE_ID },
		});
		await request(app.getHttpServer())
			.patch("/rest/workspace")
			.set("Cookie", member.cookie)
			.send({ name: "Denied", website: "" })
			.expect(403);
		await request(app.getHttpServer())
			.patch("/rest/workspace")
			.set("Cookie", owner.cookie)
			.send({ name: "Denied", website: "not a website" })
			.expect(400);
		expect(
			await db.organization.findUniqueOrThrow({ where: { id: WORKSPACE_ID } }),
		).toEqual(before);
	});

	it("rejects a revoked membership even while its authenticated session remains valid", async () => {
		await request(app.getHttpServer())
			.get("/rest/workspace")
			.set("Cookie", revoked.cookie)
			.expect(200);
		await revoked.revoke();
		await request(app.getHttpServer())
			.get("/auth/me")
			.set("Cookie", revoked.cookie)
			.expect(200);
		await request(app.getHttpServer())
			.get("/rest/workspace")
			.set("Cookie", revoked.cookie)
			.expect(403);
	});

	it("rejects tampered, expired and absent session cookies", async () => {
		const separator = owner.cookie.indexOf("=");
		const tampered = `${owner.cookie.slice(0, separator + 1)}x${owner.cookie.slice(separator + 2)}`;
		for (const cookie of [tampered, expired.cookie, ""]) {
			await request(app.getHttpServer())
				.get("/rest/workspace")
				.set("Cookie", cookie)
				.expect(401);
		}
	});

	it("reads agent inventory and operations honestly, and denies the revoked actor", async () => {
		const agents = await request(app.getHttpServer())
			.get("/rest/agents")
			.set("Cookie", owner.cookie)
			.expect(200);
		expect(Array.isArray(agents.body)).toBe(true);
		const overview = await request(app.getHttpServer())
			.get("/api/trpc/operations.overview")
			.query({ input: JSON.stringify({ hours: 24 }) })
			.set("Cookie", owner.cookie)
			.expect(200);
		expect(overview.body.result.data.health.liveProvidersVerified).toBe(false);
		expect(overview.body.result.data.health.outcomeLedgerImplemented).toBe(
			false,
		);
		const capabilities = await request(app.getHttpServer())
			.get("/api/trpc/operations.capabilities")
			.query({ input: "{}" })
			.set("Cookie", owner.cookie)
			.expect(200);
		expect(capabilities.body.result.data.approvalsEnabled).toBe(
			process.env.AGENT_APPROVAL_CENTER_ENABLED === "1",
		);
		expect(capabilities.body.result.data.liveProviderHealthVerified).toBe(
			false,
		);
		await request(app.getHttpServer())
			.get("/rest/agents")
			.set("Cookie", revoked.cookie)
			.expect(403);
		await request(app.getHttpServer())
			.get("/api/trpc/operations.overview")
			.query({ input: JSON.stringify({ hours: 24 }) })
			.set("Cookie", revoked.cookie)
			.expect(403);
	});

	it("preserves omission, clears blank, and triggers research exactly once for a changed normalized website", async () => {
		class RecordingAgent extends AgentTriggerService {
			readonly websites: string[] = [];
			override async workspaceChanged(website: string) {
				this.websites.push(website);
			}
		}
		const agent = new RecordingAgent(db);
		const service = new WorkspaceService(db, agent);
		await db.organization.update({
			where: { id: WORKSPACE_ID },
			data: { website: "acme.com" },
		});
		expect(
			(await service.update(owner.user.id, { name: "HTTP fixture" })).website,
		).toBe("acme.com");
		await service.update(owner.user.id, {
			name: "HTTP fixture",
			website: " HTTPS://www.Acme.com/about ",
		});
		expect(agent.websites).toEqual([]);
		await service.update(owner.user.id, {
			name: "HTTP fixture",
			website: "new.example",
		});
		expect(agent.websites).toEqual(["new.example"]);
		expect(
			(
				await service.update(owner.user.id, {
					name: "HTTP fixture",
					website: "  ",
				})
			).website,
		).toBeNull();
		expect(agent.websites).toEqual(["new.example"]);
	});

	it("creates a real company, contact and deal and reads back their relationships", async () => {
		const http = () => request(app.getHttpServer());
		const company = await http()
			.post("/rest/companies")
			.set("Cookie", member.cookie)
			.send({ name: `Journey ${member.user.id}`, ownerId: member.user.id })
			.expect(200);
		companyIds.push(company.body.id);
		const contact = await http()
			.post("/rest/contacts")
			.set("Cookie", member.cookie)
			.send({
				firstName: "Test",
				lastName: "Customer",
				companyId: company.body.id,
				ownerId: member.user.id,
			})
			.expect(200);
		contactIds.push(contact.body.id);
		const deal = await http()
			.post("/rest/deals")
			.set("Cookie", member.cookie)
			.send({
				name: "Customer next step",
				companyId: company.body.id,
				ownerId: member.user.id,
				currency: "USD",
				amountCents: 25000,
			})
			.expect(200);
		dealIds.push(deal.body.id);
		const detail = await http()
			.get(`/rest/deals/${deal.body.id}`)
			.set("Cookie", member.cookie)
			.expect(200);
		expect(detail.body.company.id).toBe(company.body.id);
		expect(detail.body.owner.id).toBe(member.user.id);
		const contactDetail = await http()
			.get(`/rest/contacts/${contact.body.id}`)
			.set("Cookie", member.cookie)
			.expect(200);
		expect(contactDetail.body.company.id).toBe(company.body.id);
	});

	it("records notes and tasks, isolates myTasks by actor, and completes/reopens the next step", async () => {
		const http = () => request(app.getHttpServer());
		const dealId = dealIds[0];
		const note = await http()
			.post("/rest/activities")
			.set("Cookie", member.cookie)
			.send({ type: "NOTE", body: "Customer requested a quote", dealId })
			.expect(200);
		activityIds.push(note.body.id);
		const task = await http()
			.post("/rest/activities")
			.set("Cookie", member.cookie)
			.send({
				type: "TASK",
				subject: "Prepare and review the quote",
				dueAt: new Date(Date.now() + 86400_000).toISOString(),
				dealId,
			})
			.expect(200);
		activityIds.push(task.body.id);
		expect(task.body.company.id).toBe(companyIds[0]);
		const mine = await http()
			.get("/rest/activities/my-tasks")
			.set("Cookie", member.cookie)
			.expect(200);
		expect(mine.body.map((row: { id: string }) => row.id)).toContain(
			task.body.id,
		);
		const other = await http()
			.get("/rest/activities/my-tasks")
			.set("Cookie", owner.cookie)
			.expect(200);
		expect(other.body.map((row: { id: string }) => row.id)).not.toContain(
			task.body.id,
		);
		const counts = await http()
			.get("/rest/activities/counts")
			.query({ dealId })
			.set("Cookie", member.cookie)
			.expect(200);
		expect(counts.body).toMatchObject({
			all: 2,
			notes: 1,
			upcoming: 1,
			done: 0,
		});
		const completed = await http()
			.patch(`/rest/activities/${task.body.id}/complete`)
			.set("Cookie", member.cookie)
			.send({ completed: true })
			.expect(200);
		expect(completed.body.completedAt).not.toBeNull();
		const after = await http()
			.get("/rest/activities/my-tasks")
			.set("Cookie", member.cookie)
			.expect(200);
		expect(after.body.map((row: { id: string }) => row.id)).not.toContain(
			task.body.id,
		);
		const reopened = await http()
			.patch(`/rest/activities/${task.body.id}/complete`)
			.set("Cookie", member.cookie)
			.send({ completed: false })
			.expect(200);
		expect(reopened.body.completedAt).toBeNull();
		expect(
			(await db.activity.findUniqueOrThrow({ where: { id: task.body.id } }))
				.completedAt,
		).toBeNull();
	});

	it("archives and restores company, contact and deal through actual HTTP mutations", async () => {
		for (const [resource, id] of [
			["companies", companyIds[0]],
			["contacts", contactIds[0]],
			["deals", dealIds[0]],
		] as const) {
			await request(app.getHttpServer())
				.post(`/rest/${resource}/${id}/archive`)
				.set("Cookie", member.cookie)
				.send({})
				.expect(200);
			const archived = await request(app.getHttpServer())
				.post(`/rest/${resource}/search`)
				.set("Cookie", member.cookie)
				.send({
					archived: true,
					q:
						resource === "companies"
							? `Journey ${member.user.id}`
							: resource === "contacts"
								? "Customer"
								: "Customer next step",
				})
				.expect(200);
			expect(archived.body.rows.map((row: { id: string }) => row.id)).toContain(
				id,
			);
			await request(app.getHttpServer())
				.post(`/rest/${resource}/${id}/restore`)
				.set("Cookie", member.cookie)
				.send({})
				.expect(200);
			const active = await request(app.getHttpServer())
				.post(`/rest/${resource}/search`)
				.set("Cookie", member.cookie)
				.send({
					archived: false,
					q:
						resource === "companies"
							? `Journey ${member.user.id}`
							: resource === "contacts"
								? "Customer"
								: "Customer next step",
				})
				.expect(200);
			expect(active.body.rows.map((row: { id: string }) => row.id)).toContain(
				id,
			);
		}
	});

	it("denies missing relations, invalid activities, absent records and unauthenticated writes without adding data", async () => {
		const missingId = `missing-${member.user.id}`;
		const before = await db.deal.count({ where: { ownerId: member.user.id } });
		await request(app.getHttpServer())
			.post("/rest/deals")
			.set("Cookie", member.cookie)
			.send({
				name: "Denied",
				companyId: missingId,
				ownerId: member.user.id,
				currency: "USD",
			})
			.expect(400);
		expect(await db.deal.count({ where: { ownerId: member.user.id } })).toBe(
			before,
		);
		await request(app.getHttpServer())
			.post("/rest/activities")
			.set("Cookie", member.cookie)
			.send({ type: "TASK", companyId: companyIds[0], subject: "" })
			.expect(400);
		await request(app.getHttpServer())
			.patch(`/rest/activities/${activityIds[0]}/complete`)
			.set("Cookie", member.cookie)
			.send({ completed: true })
			.expect(400);
		await request(app.getHttpServer())
			.get(`/rest/companies/${missingId}`)
			.set("Cookie", member.cookie)
			.expect(404);
		await request(app.getHttpServer())
			.post("/rest/companies")
			.send({ name: "Denied" })
			.expect(401);
	});
});
