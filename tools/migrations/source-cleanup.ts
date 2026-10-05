/** Preview by default. Apply requires the exact cutoff and hash from a previous review. */
import { db, setPrismaLogSink } from "@crm/db/client";
import { WORKSPACE_ID } from "@crm/db/workspace";
import { createMigrationApplicationFromEnvironment } from "../../apps/api/src/migrations/migration-application.mjs";

const values: Record<string, string> = {};
const args = process.argv.slice(2);
let apply = false;
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--apply") {
		apply = true;
		continue;
	}
	if (
		!["--actor", "--cutoff", "--plan"].includes(args[i] ?? "") ||
		!args[i + 1] ||
		args[i + 1]?.startsWith("--")
	)
		throw new Error(
			"Usage: --actor <current-admin-id> [--cutoff <ISO> --apply --plan <SHA256>]",
		);
	if (values[args[i]!]) throw new Error("Duplicate option");
	values[args[i]!] = args[++i]!;
}
if (!values["--actor"] || (apply && (!values["--plan"] || !values["--cutoff"])))
	throw new Error("An explicit admin and reviewed apply plan are required");
setPrismaLogSink(({ level }) => {
	if (level === "error") console.error("SOURCE_CLEANUP_DATABASE_ERROR");
});
try {
	const app = await createMigrationApplicationFromEnvironment({
		db,
		workspaceId: WORKSPACE_ID,
	});
	const report = await app.cleanupSources(
		{ tenantId: WORKSPACE_ID, actorId: values["--actor"]! },
		{ apply, cutoff: values["--cutoff"], expectedPlanHash: values["--plan"] },
	);
	console.log(JSON.stringify(report, null, 2));
	if (report.results.some((r) => r.status !== "PURGED")) process.exitCode = 2;
} catch {
	console.error(
		"SOURCE_CLEANUP_NOT_COMPLETED: review permissions, plan drift, volume and source audit",
	);
	process.exitCode = 1;
} finally {
	await db.$disconnect();
}
