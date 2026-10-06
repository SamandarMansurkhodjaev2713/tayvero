import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FollowUpQueueView } from "../app/(app)/[slug]/personal-follow-ups-view";
import type { RouterOutputs } from "../lib/trpc/types";

type Task = RouterOutputs["activities"]["myTasks"][number];
function task(id: string, dueAt: string | null = null): Task {
	return {
		id,
		type: "TASK",
		subject: `Call ${id}`,
		body: null,
		occurredAt: null,
		dueAt,
		completedAt: null,
		meta: null,
		createdAt: "2026-10-06T00:00:00Z",
		createdBy: {
			id: "owner",
			name: "Owner",
			email: "fixture@example.invalid",
			image: null,
		},
		company: null,
		contact: null,
		deal: { id: `deal/${id}`, name: `Deal ${id}` },
		emailThread: null,
		calendarEvent: null,
	};
}
const base = {
	tasks: [task("a")],
	now: new Date("2026-10-06T12:00:00Z"),
	state: "ready" as const,
	isFetching: false,
	workspaceUrl: (path: string) => `/fixture${path}`,
	onRefresh: () => {},
	onComplete: () => {},
};

describe("follow-up queue rendered state", () => {
	it("loading does not fabricate an empty or zero task count", () => {
		const html = renderToStaticMarkup(
			<FollowUpQueueView {...base} tasks={[]} now={null} state="loading" />,
		);
		expect(html).toContain('aria-label="Loading your follow-ups"');
		expect(html).not.toContain("No open tasks");
		expect(html).not.toContain("0 loaded");
	});
	it("failed first load names the unavailable counts and offers refresh", () => {
		const html = renderToStaticMarkup(
			<FollowUpQueueView {...base} tasks={[]} state="error" />,
		);
		expect(html).toContain('role="alert"');
		expect(html).toContain("No task counts are available yet");
		expect(html).toContain("Refresh tasks");
		expect(html).not.toContain("No open tasks");
	});
	it("retained stale tasks stay visible, but completing them is disabled", () => {
		const html = renderToStaticMarkup(
			<FollowUpQueueView {...base} state="stale" />,
		);
		expect(html).toContain("previous snapshot");
		expect(html).toContain("Call a");
		expect(html).toMatch(
			/<button[^>]*disabled=""[^>]*aria-label="Mark Call a as done"/,
		);
	});
	it("links target a real record route and explicitly distinguish creator ownership", () => {
		const html = renderToStaticMarkup(<FollowUpQueueView {...base} />);
		expect(html).toContain('href="/fixture/deals/deal%2Fa"');
		expect(html).toContain("Tasks you created");
		expect(html).not.toContain("assigned to you");
		expect(html).toContain("No due date");
	});
	it("all 100 returned rows remain accessible through native disclosure with truncation warning", () => {
		const tasks = Array.from({ length: 100 }, (_, i) => task(String(i)));
		const html = renderToStaticMarkup(
			<FollowUpQueueView {...base} tasks={tasks} />,
		);
		expect(html).toContain("100-task limit was reached");
		expect(html).toContain("may be missing");
		expect(html).toContain("Show 95 remaining loaded tasks");
		expect(html).toContain("<details");
		expect((html.match(/aria-label="Mark Call /g) ?? []).length).toBe(100);
	});
	it("later tasks are reachable and malformed dates carry a review message", () => {
		const html = renderToStaticMarkup(
			<FollowUpQueueView
				{...base}
				tasks={[
					task("later", "2030-01-01T00:00:00Z"),
					task("invalid", "bad-date"),
				]}
			/>,
		);
		expect(html).toContain("Later · 1 loaded");
		expect(html).toContain("Call later");
		expect(html).toContain("Invalid due date");
	});
	it("pending completion blocks repeated actions while preserving other rows and error feedback", () => {
		const html = renderToStaticMarkup(
			<FollowUpQueueView
				{...base}
				tasks={[task("a"), task("b")]}
				pendingId="a"
				error="Permission denied"
			/>,
		);
		expect(html).toContain("Completing…");
		expect(html).toContain("Call b");
		expect(html).toContain("Permission denied");
		expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
	});
	it("empty success describes the bounded snapshot and exposes a real creation entry point", () => {
		const html = renderToStaticMarkup(
			<FollowUpQueueView {...base} tasks={[]} />,
		);
		expect(html).toContain("No open tasks in this loaded snapshot");
		expect(html).toContain('href="/fixture/deals"');
		expect(html).not.toContain("Every task");
	});
});
