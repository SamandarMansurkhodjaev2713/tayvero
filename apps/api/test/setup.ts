import { afterAll } from "bun:test";

if (process.env.NODE_ENV !== "test") {
	throw new Error("Integration tests require NODE_ENV=test; do not run with a production environment.");
}

afterAll(async () => {
	if (!process.env.TEST_DATABASE_URL) return;
	const { db } = await import("@crm/db");
	await db.$disconnect();
});
