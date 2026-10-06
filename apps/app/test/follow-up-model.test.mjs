import assert from "node:assert/strict";
import { test } from "node:test";
import {
	classifyFollowUpDeadline,
	followUpLoadState,
	groupFollowUps,
	removeConfirmedFollowUp,
} from "../app/(app)/[slug]/follow-up-model.mjs";

test("Tashkent midnight uses the local day, even while UTC remains yesterday", () => {
	const now = new Date("2026-10-05T19:00:00Z");
	assert.equal(
		classifyFollowUpDeadline("2026-10-05T18:59:59Z", now, "Asia/Tashkent"),
		"overdue",
	);
	assert.equal(
		classifyFollowUpDeadline("2026-10-05T19:00:00Z", now, "Asia/Tashkent"),
		"today",
	);
	assert.equal(
		classifyFollowUpDeadline("2026-10-06T19:00:00Z", now, "Asia/Tashkent"),
		"upcoming",
	);
});

test("earlier today stays in Today; an overdue calendar day is not an elapsed-hour check", () => {
	const now = new Date("2026-10-06T17:00:00Z");
	assert.equal(
		classifyFollowUpDeadline("2026-10-06T00:00:00Z", now, "Asia/Tashkent"),
		"today",
	);
	assert.equal(
		classifyFollowUpDeadline("2026-10-05T18:59:59Z", now, "Asia/Tashkent"),
		"overdue",
	);
});

test("spring DST day is 23 hours; the next calendar day is still upcoming", () => {
	const now = new Date("2026-03-08T05:00:00Z");
	assert.equal(
		classifyFollowUpDeadline("2026-03-09T03:59:59Z", now, "America/New_York"),
		"today",
	);
	assert.equal(
		classifyFollowUpDeadline("2026-03-09T04:00:00Z", now, "America/New_York"),
		"upcoming",
	);
	assert.equal(
		classifyFollowUpDeadline("2026-03-08T04:59:59Z", now, "America/New_York"),
		"overdue",
	);
});

test("fall DST day is 25 hours; both occurrences of the repeated hour are today", () => {
	const now = new Date("2026-11-01T04:00:00Z");
	for (const due of [
		"2026-11-01T05:30:00Z",
		"2026-11-01T06:30:00Z",
		"2026-11-02T04:59:59Z",
	])
		assert.equal(
			classifyFollowUpDeadline(due, now, "America/New_York"),
			"today",
		);
	assert.equal(
		classifyFollowUpDeadline("2026-11-02T05:00:00Z", now, "America/New_York"),
		"upcoming",
	);
});

test("one instant has different day buckets in different viewer timezones", () => {
	const now = new Date("2026-10-06T00:30:00Z");
	const due = "2026-10-05T23:30:00Z";
	assert.equal(classifyFollowUpDeadline(due, now, "UTC"), "overdue");
	assert.equal(classifyFollowUpDeadline(due, now, "Asia/Tashkent"), "today");
});

test("missing and malformed dates remain visible for review rather than disappearing", () => {
	const now = new Date("2026-10-06T12:00:00Z");
	for (const due of [null, "", "bad-date"])
		assert.equal(classifyFollowUpDeadline(due, now, "UTC"), "undated");
	assert.throws(
		() => classifyFollowUpDeadline(null, new Date("bad-date"), "UTC"),
		RangeError,
	);
});

test("all returned open tasks stay reachable; grouping retains record data and server order", () => {
	const tasks = [
		{ id: "a", dueAt: null, completedAt: null, deal: { id: "deal/a" } },
		{ id: "b", dueAt: "bad-date", completedAt: null },
		{ id: "c", dueAt: "2026-10-07T00:00:00Z", completedAt: null },
		{ id: "done", dueAt: null, completedAt: "2026-10-06T00:00:00Z" },
	];
	const groups = groupFollowUps(tasks, new Date("2026-10-06T12:00:00Z"), "UTC");
	assert.deepEqual(
		groups.undated.map((task) => task.id),
		["a", "b"],
	);
	assert.equal(groups.undated[0], tasks[0]);
	assert.deepEqual(
		groups.upcoming.map((task) => task.id),
		["c"],
	);
	assert.equal(Object.values(groups).flat().length, 3);
	assert.equal(tasks.length, 4);
});

test("loading, failed first load, empty success and failed refresh have distinct states", () => {
	assert.equal(followUpLoadState(undefined, false, false), "loading");
	assert.equal(followUpLoadState(undefined, true, true), "error");
	assert.equal(followUpLoadState([], false, false), "loading");
	assert.equal(followUpLoadState([], false, true), "ready");
	assert.equal(followUpLoadState([], true, true), "stale");
	assert.equal(followUpLoadState([{ id: "cached" }], true, true), "stale");
});

test("completion acknowledgement removes only the confirmed task and never mutates cache in place", () => {
	const tasks = [{ id: "a" }, { id: "b" }];
	assert.equal(
		removeConfirmedFollowUp(tasks, { id: "a", completedAt: null }),
		tasks,
	);
	assert.deepEqual(
		removeConfirmedFollowUp(tasks, {
			id: "a",
			completedAt: "2026-10-06T12:00:00Z",
		}),
		[{ id: "b" }],
	);
	assert.deepEqual(
		removeConfirmedFollowUp(tasks, {
			id: "other",
			completedAt: "2026-10-06T12:00:00Z",
		}),
		tasks,
	);
	assert.equal(tasks.length, 2);
	assert.equal(
		removeConfirmedFollowUp(undefined, {
			id: "a",
			completedAt: "2026-10-06T12:00:00Z",
		}),
		undefined,
	);
});
