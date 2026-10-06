import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
	resolveTaskDeadline,
	taskCreationFields,
	taskDeadlineInput,
	taskEditPatch,
} from "../lib/task-editor-model.mjs";

test("unchanged displayed deadline preserves the original instant, seconds and offset", () => {
	const original = "2026-10-06T11:42:17.456+05:00";
	assert.equal(
		resolveTaskDeadline(taskDeadlineInput(original), original),
		original,
	);
});

test("task creation sends an explicit ISO instant, distinguishes default self from unassigned, and has no hidden midnight", () => {
	const scheduled = taskCreationFields({
		deadline: "2026-10-06T14:45",
		assigneeId: "member-a",
	});
	assert.equal(taskDeadlineInput(scheduled.dueAt), "2026-10-06T14:45");
	assert.match(scheduled.dueAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
	assert.equal(scheduled.assigneeId, "member-a");
	assert.deepEqual(
		taskCreationFields({ deadline: "", assigneeId: undefined }),
		{ dueAt: null },
	);
	assert.deepEqual(taskCreationFields({ deadline: "", assigneeId: null }), {
		dueAt: null,
		assigneeId: null,
	});
	assert.throws(
		() =>
			taskCreationFields({
				deadline: "2026-02-31T14:45",
				assigneeId: undefined,
			}),
		/invalid/,
	);
});

test("omitted fields preserve, explicit blanks clear, and reassignment only sends changed fields", () => {
	const task = { assignee: { id: "a" }, dueAt: "2026-10-06T11:42:17Z" };
	assert.deepEqual(
		taskEditPatch(
			{ assigneeId: "a", deadline: taskDeadlineInput(task.dueAt) },
			task,
		),
		{},
	);
	assert.deepEqual(taskEditPatch({ assigneeId: null, deadline: "" }, task), {
		assigneeId: null,
		dueAt: null,
	});
	assert.deepEqual(
		taskEditPatch(
			{ assigneeId: "b", deadline: taskDeadlineInput(task.dueAt) },
			task,
		),
		{ assigneeId: "b" },
	);
	assert.deepEqual(
		taskEditPatch(
			{ assigneeId: null, deadline: "" },
			{ assignee: null, dueAt: null },
		),
		{},
	);
});

test("invalid or rolled-over dates are rejected rather than rescheduled silently", () => {
	for (const value of [
		"not-a-date",
		"2026-02-31T12:00",
		"2026-13-01T12:00",
		"2026-10-06T24:00",
		"2026-10-06T12:99",
	])
		assert.throws(() => resolveTaskDeadline(value, null), Error);
});

test("a new local wall time produces a real instant and a blank clears it", () => {
	const value = "2026-10-06T12:30";
	const instant = resolveTaskDeadline(value, null);
	assert.equal(taskDeadlineInput(instant), value);
	assert.equal(resolveTaskDeadline("", instant), null);
});

test("New York DST gap is rejected; unchanged repeated-hour instant remains exact", () => {
	// A fresh Node process honors TZ consistently on Windows and Linux; no browser or database.
	const script = `import assert from 'node:assert/strict'; import { resolveTaskDeadline, taskDeadlineInput } from ${JSON.stringify(new URL("../lib/task-editor-model.mjs", import.meta.url).href)};
	assert.throws(() => resolveTaskDeadline('2026-03-08T02:30', null), /does not exist/);
	assert.equal(resolveTaskDeadline('2026-03-08T03:30', null), '2026-03-08T07:30:00.000Z');
	for (const original of ['2026-11-01T05:30:37Z','2026-11-01T06:30:37Z']) assert.equal(resolveTaskDeadline(taskDeadlineInput(original), original), original);`;
	const result = spawnSync("node", ["--input-type=module", "--eval", script], {
		env: { ...process.env, TZ: "America/New_York" },
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
});
