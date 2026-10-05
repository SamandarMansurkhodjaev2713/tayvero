import assert from "node:assert/strict";
import test from "node:test";
import { requireDeploymentMembership } from "../src/trpc/workspace-access.mjs";

const session = () => ({
	user: { id: "alice" },
	session: {
		userId: "alice",
		activeOrganizationId: "deployment-fixture",
		expiresAt: "2030-01-01T00:00:00Z",
	},
});
const run = (patch = {}) =>
	requireDeploymentMembership({
		session: session(),
		workspaceId: "deployment-fixture",
		now: 1,
		findMembership: async () => ({ role: "member" }),
		...patch,
	});
test("auth revalidates current membership using trusted deployment identity", async () => {
	let requested;
	const result = await run({
		findMembership: async (input) => {
			requested = input;
			return { role: "admin" };
		},
	});
	assert.deepEqual(requested, {
		workspaceId: "deployment-fixture",
		userId: "alice",
	});
	assert.equal(result.role, "admin");
});
test("removed member with otherwise live session is forbidden immediately", async () => {
	let member = { role: "member" };
	const findMembership = async () => member;
	await run({ findMembership });
	member = null;
	await assert.rejects(run({ findMembership }), { code: "FORBIDDEN" });
});
test("foreign workspace session cannot read singleton CRM tables", async () => {
	const value = session();
	value.session.activeOrganizationId = "another-company";
	let called = false;
	await assert.rejects(
		run({
			session: value,
			findMembership: async () => {
				called = true;
				return { role: "owner" };
			},
		}),
		{ code: "FORBIDDEN" },
	);
	assert.equal(called, false);
});
test("API-key synthetic session without active organization still needs membership", async () => {
	const value = session();
	delete value.session.activeOrganizationId;
	assert.equal((await run({ session: value })).role, "member");
	await assert.rejects(
		run({ session: value, findMembership: async () => null }),
		{ code: "FORBIDDEN" },
	);
});
test("expired, mismatched, missing or malformed sessions fail closed", async () => {
	for (const value of [
		null,
		{},
		{ user: { id: "alice" } },
		{ ...session(), session: { ...session().session, userId: "bob" } },
		{ ...session(), session: { ...session().session, expiresAt: null } },
		{ ...session(), session: { ...session().session, expiresAt: "invalid" } },
	])
		await assert.rejects(run({ session: value }), { code: "UNAUTHORIZED" });
	const expires = Date.parse(session().session.expiresAt);
	await assert.rejects(run({ now: expires }), { code: "UNAUTHORIZED" });
});
test("unrecognized membership roles are denied rather than promoted to member", async () => {
	for (const role of ["viewer", "deleted", "ADMIN", "", null])
		await assert.rejects(run({ findMembership: async () => ({ role }) }), {
			code: "FORBIDDEN",
		});
});
