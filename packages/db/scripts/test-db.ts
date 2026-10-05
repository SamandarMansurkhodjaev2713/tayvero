import "@crm/env/load";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import pg from "pg";
import {
	assertTestDatabaseResetAllowed,
	resolveTestDatabase,
} from "../src/test-database.mjs";

const SCHEMA = join(dirname(import.meta.dirname), "prisma", "schema.prisma");
const MIGRATIONS = join(dirname(import.meta.dirname), "prisma", "migrations");

const { url, database: name } = resolveTestDatabase(process.env);
const reset = process.argv.includes("--reset");
if (reset) assertTestDatabaseResetAllowed(process.env);
await create(url, name, reset);
migrate(url);

async function create(
	target: string,
	database: string,
	forced: boolean,
): Promise<void> {
	const maintenance = new URL(target);
	maintenance.pathname = "/postgres";
	maintenance.search = "";
	const sslmode = new URL(target).searchParams.get("sslmode");
	if (sslmode) maintenance.searchParams.set("sslmode", sslmode);

	const client = new pg.Client({ connectionString: maintenance.toString() });

	try {
		await client.connect();
	} catch (error) {
		fail([
			`Could not reach the server at ${new URL(target).host}.`,
			"Is Postgres running?  docker compose up -d",
			"",
			"Connection failed; check test credentials and server availability. Connection URLs are not logged.",
		]);
	}

	try {
		const existing = await client.query(
			"SELECT 1 FROM pg_database WHERE datname = $1",
			[database],
		);

		if (existing.rowCount) {
			const reason = forced
				? "you asked for --reset"
				: await stale(target, database);

			if (!reason) {
				console.log(`  ${database} already exists`);
				return;
			}

			// Never rebuild automatically: stale data may belong to another test run.
			if (!forced) {
				fail([
					reason,
					"No database was dropped. Use an isolated fresh database, or explicitly set ALLOW_TEST_DATABASE_RESET=1 and pass --reset.",
				]);
			}
			console.log(`  rebuilding ${database}: explicit reset approved`);
			await drop(client, database);
		}

		await client.query(`CREATE DATABASE "${database}"`);
		console.log(`  created ${database}`);
	} finally {
		await client.end();
	}
}

async function drop(client: pg.Client, database: string): Promise<void> {
	await client.query(
		`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
		 WHERE datname = $1 AND pid <> pg_backend_pid()`,
		[database],
	);
	await client.query(`DROP DATABASE IF EXISTS "${database}"`);
}

async function stale(target: string, database: string): Promise<string | null> {
	const applied = await appliedMigrations(target);

	if (applied === null) return null;

	const onDisk = new Set(
		existsSync(MIGRATIONS)
			? readdirSync(MIGRATIONS, { withFileTypes: true })
					.filter((entry) => entry.isDirectory())
					.map((entry) => entry.name)
			: [],
	);

	const foreign = applied.filter((migration) => !onDisk.has(migration));

	if (foreign.length > 0) {
		return `${database} holds ${foreign.length} migration(s) this branch does not have, starting with ${foreign[0]}`;
	}

	// Pending additive migrations are not evidence of drift. Deploy them first.
	if ([...onDisk].some((migration) => !applied.includes(migration)))
		return null;
	return drifted(target) ? `${database} no longer matches schema.prisma` : null;
}

async function appliedMigrations(target: string): Promise<string[] | null> {
	const client = new pg.Client({ connectionString: target });

	try {
		await client.connect();
	} catch {
		fail([
			"Could not inspect the existing test database. No reset was attempted.",
		]);
	}

	try {
		const rows = await client.query<{ migration_name: string }>(
			`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
		);
		return rows.rows.map((row) => row.migration_name);
	} catch (error) {
		if ((error as { code?: string }).code === "42P01") return null;
		fail(["Could not read test migration history. No reset was attempted."]);
	} finally {
		await client.end();
	}
}

function drifted(target: string): boolean {
	const result = spawnSync(
		"prisma",
		[
			"migrate",
			"diff",
			"--from-config-datasource",
			"--to-schema",
			SCHEMA,
			"--exit-code",
		],
		{ stdio: "ignore", env: { ...process.env, DATABASE_URL: target } },
	);

	if (result.error || (result.status !== 0 && result.status !== 2)) {
		fail(["Prisma drift inspection failed. No reset was attempted."]);
	}
	return result.status === 2;
}

function migrate(target: string): void {
	const result = spawnSync("prisma", ["migrate", "deploy"], {
		stdio: "inherit",
		env: { ...process.env, DATABASE_URL: target },
	});

	if (result.error) {
		fail([
			"Could not run prisma migrate deploy.",
			"Run this through the package script, which puts prisma on PATH:",
			"",
			"    bun run db:test",
			"",
			result.error.message,
		]);
	}

	if (result.status !== 0) process.exit(result.status ?? 1);
}

function fail(lines: string[]): never {
	console.error(["", ...lines.map((line) => `  ${line}`), ""].join("\n"));
	process.exit(1);
}
