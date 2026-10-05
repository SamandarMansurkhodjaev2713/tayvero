import { afterAll } from "bun:test";

if (process.env.NODE_ENV !== "test") {
	throw new Error(
		"Integration tests require NODE_ENV=test; do not run with a production environment.",
	);
}

// Auth config is captured on its first import. Establish the synthetic OAuth
// fixture before any test module imports auth; no provider request uses these keys.
// Preserve partial-pair validation instead of filling one missing real setting.
if (!process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_SECRET) {
	process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
	process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
}

afterAll(async () => {
	if (!process.env.TEST_DATABASE_URL) return;
	const { db } = await import("@crm/db");
	await db.$disconnect();
});
