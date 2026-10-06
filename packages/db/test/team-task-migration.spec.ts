import { expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { resolveTestDatabase } from "../src/test-database.mjs";

it("executes assignment migration against legacy rows without assigning revoked, foreign or NOTE authors", async () => {
	if (process.env.NODE_ENV !== "test")
		throw new Error("Migration fixture requires NODE_ENV=test");
	const { url } = resolveTestDatabase(process.env);
	const client = new pg.Client({ connectionString: url });
	const schema = `task_migration_${randomUUID().replaceAll("-", "")}`;
	await client.connect();
	try {
		await client.query("BEGIN");
		await client.query(`CREATE SCHEMA "${schema}"`);
		await client.query(`SET LOCAL search_path TO "${schema}"`);
		// Only the pre-migration columns referenced by the actual SQL are needed.
		// This transactional schema never resets or modifies the application's tables.
		await client.query(`CREATE TABLE "user" (id TEXT PRIMARY KEY);
			CREATE TABLE member ("userId" TEXT, "organizationId" TEXT, role TEXT);
			CREATE TABLE activity (id TEXT PRIMARY KEY, type TEXT, "createdById" TEXT, "completedAt" TIMESTAMP(3), "dueAt" TIMESTAMP(3));
			INSERT INTO "user" VALUES ('active'), ('revoked'), ('foreign'), ('invalid-role');
			INSERT INTO member VALUES ('active','workspace','member'), ('foreign','foreign','owner'), ('invalid-role','workspace','revoked');
			INSERT INTO activity (id,type,"createdById") VALUES ('active-task','TASK','active'), ('revoked-task','TASK','revoked'), ('foreign-task','TASK','foreign'), ('invalid-role-task','TASK','invalid-role'), ('note','NOTE','active');`);
		const sql = await readFile(
			new URL(
				"../prisma/migrations/20261006120000_team_task_assignment/migration.sql",
				import.meta.url,
			),
			"utf8",
		);
		await client.query(sql);
		const { rows } = await client.query(
			'SELECT id, "createdById", "assigneeId", "taskVersion" FROM activity ORDER BY id',
		);
		expect(rows).toEqual([
			{
				id: "active-task",
				createdById: "active",
				assigneeId: "active",
				taskVersion: 0,
			},
			{
				id: "foreign-task",
				createdById: "foreign",
				assigneeId: null,
				taskVersion: 0,
			},
			{
				id: "invalid-role-task",
				createdById: "invalid-role",
				assigneeId: null,
				taskVersion: 0,
			},
			{ id: "note", createdById: "active", assigneeId: null, taskVersion: 0 },
			{
				id: "revoked-task",
				createdById: "revoked",
				assigneeId: null,
				taskVersion: 0,
			},
		]);
		await client.query(
			`INSERT INTO activity (id,type,"createdById") VALUES ('future-legacy','TASK','active')`,
		);
		expect(
			(
				await client.query(
					`SELECT "assigneeId" FROM activity WHERE id='future-legacy'`,
				)
			).rows[0],
		).toEqual({ assigneeId: null });
		await client.query("SAVEPOINT negative_version");
		let refusal: unknown;
		try {
			await client.query(
				`UPDATE activity SET "taskVersion"=-1 WHERE id='active-task'`,
			);
		} catch (error) {
			refusal = error;
		}
		expect(refusal).toMatchObject({ code: "23514" });
		await client.query("ROLLBACK TO SAVEPOINT negative_version");
		expect(
			(
				await client.query(
					`SELECT "taskVersion" FROM activity WHERE id='active-task'`,
				)
			).rows[0],
		).toEqual({ taskVersion: 0 });
	} finally {
		try {
			await client.query("ROLLBACK");
		} finally {
			await client.end();
		}
	}
});
