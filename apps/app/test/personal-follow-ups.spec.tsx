import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FollowUpQueueView } from "../app/(app)/[slug]/personal-follow-ups-view";
import { TaskAssigneePicker } from "../components/crm/tasks/task-assignee-picker";
import {
	TaskEditorForm,
	TaskVersionNotice,
} from "../components/crm/tasks/task-editor";
import { TaskHistoryList } from "../components/crm/tasks/task-history";
import { TRPCReactProvider } from "../lib/trpc/client";
import type { RouterOutputs } from "../lib/trpc/types";

type Task = RouterOutputs["activities"]["taskById"];
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
		updatedAt: "2026-10-06T00:00:00Z",
		taskVersion: 2,
		assignee: {
			id: "assignee",
			name: "Responsible person",
			email: "assignee@example.invalid",
			image: null,
		},
		assigneeActive: true,
		taskPermissions: { canEdit: true, canReassign: false },
		createdBy: {
			id: "owner",
			name: "Creator",
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
	scope: "me" as const,
	status: "open" as const,
	page: 0,
	total: 1,
	counts: { open: 1, completed: 0, overdue: 0, unassigned: 0 },
	isFetching: false,
	workspaceUrl: (path: string) => `/fixture${path}`,
	onRefresh: () => {},
	onComplete: () => {},
	onEdit: () => {},
	onScopeChange: () => {},
	onStatusChange: () => {},
	onPageChange: () => {},
};

describe("assigned task queue rendered state", () => {
	it("team unassigned filter remains explicit while stale, filtered counts are scoped, and mine hides the team filter", () => {
		const filter = (
			<TaskAssigneePicker
				filterMode
				value={null}
				disabled
				onChange={() => {}}
			/>
		);
		const team = renderToStaticMarkup(
			<TRPCReactProvider>
				<FollowUpQueueView
					{...base}
					scope="team"
					state="stale"
					responsibleFiltered
					responsibleFilter={filter}
				/>
			</TRPCReactProvider>,
		);
		expect(team).toContain("Filter by responsible person");
		expect(team).toContain("Unassigned");
		expect(team).toContain("selected responsible-person filter");
		expect(team).toMatch(/<button[^>]*role="combobox"[^>]*disabled=""/);
		const mine = renderToStaticMarkup(
			<FollowUpQueueView {...base} responsibleFilter={filter} />,
		);
		expect(mine).not.toContain("Filter by responsible person");
		const all = renderToStaticMarkup(
			<TRPCReactProvider>
				<TaskAssigneePicker
					filterMode
					value={undefined}
					disabled
					onChange={() => {}}
				/>
			</TRPCReactProvider>,
		);
		expect(all).toContain("All responsible people");
	});
	it("loading does not fabricate empty tasks or complete counts", () => {
		const html = renderToStaticMarkup(
			<FollowUpQueueView {...base} tasks={[]} now={null} state="loading" />,
		);
		expect(html).toContain('aria-label="Loading task queue"');
		expect(html).not.toContain("Scope totals:");
		expect(html).not.toContain("0 tasks shown");
	});
	it("failed first load offers recovery without a fabricated empty state", () => {
		const html = renderToStaticMarkup(
			<FollowUpQueueView {...base} tasks={[]} state="error" />,
		);
		expect(html).toContain('role="alert"');
		expect(html).toContain("No task counts are available yet");
		expect(html).toContain("Refresh tasks");
		expect(html).not.toContain("No tasks assigned");
	});
	it("stale snapshot retains tasks and disables mutations", () => {
		const html = renderToStaticMarkup(
			<FollowUpQueueView {...base} state="stale" />,
		);
		expect(html).toContain("previous snapshot");
		expect(html).toContain("Call a");
		expect(html).toMatch(
			/<button[^>]*disabled=""[^>]*aria-label="Mark as done: Call a"/,
		);
	});
	it("real links and separate creator/assignee provenance avoid creator-as-owner confusion", () => {
		const html = renderToStaticMarkup(<FollowUpQueueView {...base} />);
		expect(html).toContain('href="/fixture/deals/deal%2Fa"');
		expect(html).toContain("tasks assigned to you");
		expect(html).toContain("Responsible: Responsible person");
		expect(html).toContain("Created by Creator");
	});
	it("a page exposes every returned row and distinguishes scoped totals from page group counts", () => {
		const tasks = Array.from({ length: 25 }, (_, i) => task(String(i)));
		const html = renderToStaticMarkup(
			<FollowUpQueueView
				{...base}
				tasks={tasks}
				total={101}
				page={1}
				counts={{ open: 101, completed: 9, overdue: 7, unassigned: 3 }}
			/>,
		);
		expect(html).toContain("Showing 26–50 of 101 matching tasks");
		expect(html).toContain("25 on this page");
		expect(html).toContain("101 open");
		expect((html.match(/aria-label="Mark as done: Call /g) ?? []).length).toBe(
			25,
		);
		expect(html).toContain('aria-label="Tasks on the current page"');
		expect(html).toContain("Next page");
	});
	it("later tasks remain reachable and invalid dates have explicit review copy", () => {
		const html = renderToStaticMarkup(
			<FollowUpQueueView
				{...base}
				tasks={[
					task("later", "2030-01-01T00:00:00Z"),
					task("invalid", "bad-date"),
				]}
				total={2}
			/>,
		);
		expect(html).toContain("Later · 1 on this page");
		expect(html).toContain("Call later");
		expect(html).toContain("Invalid due date");
	});
	it("completed tasks offer visible reopen and are not lost by open-task grouping", () => {
		const completed = { ...task("done"), completedAt: "2026-10-06T12:00:00Z" };
		const html = renderToStaticMarkup(
			<FollowUpQueueView {...base} tasks={[completed]} status="completed" />,
		);
		expect(html).toContain("Completed");
		expect(html).toContain("Call done");
		expect(html).toContain('aria-label="Reopen Call done"');
		expect(html).not.toContain("Later ·");
	});
	it("read-only team viewers get history but no enabled task mutation", () => {
		const readonly = {
			...task("readonly"),
			taskPermissions: { canEdit: false, canReassign: false },
		};
		const html = renderToStaticMarkup(
			<FollowUpQueueView {...base} tasks={[readonly]} scope="team" />,
		);
		expect(html).toContain("tasks across the workspace");
		expect(html).toContain(">History</button>");
		expect(html).toMatch(
			/<button[^>]*disabled=""[^>]*aria-label="Mark as done: Call readonly"/,
		);
	});
	it("revoked assignment uses the actual membership signal, not member search absence", () => {
		const html = renderToStaticMarkup(
			<FollowUpQueueView
				{...base}
				tasks={[{ ...task("former"), assigneeActive: false }]}
			/>,
		);
		expect(html).toContain("no longer an active member");
		expect(html).toContain("Responsible person");
	});
	it("pending completion disables competing actions and keeps recovery error visible", () => {
		const html = renderToStaticMarkup(
			<FollowUpQueueView
				{...base}
				tasks={[task("a"), task("b")]}
				total={2}
				pendingId="a"
				error="Version changed"
			/>,
		);
		expect(html).toContain("Saving…");
		expect(html).toContain("Call b");
		expect(html).toContain("Version changed");
		expect(html).toMatch(
			/<button[^>]*disabled=""[^>]*aria-label="Mark as done: Call b"/,
		);
	});
	it("a now-empty later page offers first-page recovery instead of claiming no tasks", () => {
		const html = renderToStaticMarkup(
			<FollowUpQueueView {...base} tasks={[]} total={2} page={2} />,
		);
		expect(html).toContain("2 match this view");
		expect(html).toContain("Return to first page");
		expect(html).not.toContain("No tasks assigned to you match");
	});
	it("empty mine explains assignment and links to actual task-creation records", () => {
		const html = renderToStaticMarkup(
			<FollowUpQueueView {...base} tasks={[]} total={0} />,
		);
		expect(html).toContain("No tasks assigned to you match this view");
		expect(html).toContain('href="/fixture/deals"');
		expect(html).toContain("Team for unassigned work");
	});
});

describe("task editor and durable history", () => {
	const form = (entry: Task, stale: boolean) =>
		renderToStaticMarkup(
			<TRPCReactProvider>
				<TaskEditorForm
					task={entry}
					stale={stale}
					onClose={() => {}}
					onPending={() => {}}
					onReload={async () => entry}
				/>
			</TRPCReactProvider>,
		);
	it("assignee can edit deadline but reassignment remains explicitly restricted", () => {
		const html = form(task("a"), false);
		expect(html).toContain(
			"Only the creator or a workspace administrator can change",
		);
		expect(html).toContain("Save task changes");
		expect(html).toContain('type="datetime-local"');
		expect(html).toContain("unchanged deadline keeps its exact instant");
	});
	it("read-only permissions and stale details both block editing controls", () => {
		const read = form(
			{ ...task("a"), taskPermissions: { canEdit: false, canReassign: false } },
			false,
		);
		expect(read).toContain("You can read this task and its history");
		expect(read).not.toContain("Save task changes");
		expect(read).toMatch(/<input[^>]*type="datetime-local"[^>]*disabled=""/);
		const stale = form(task("a"), true);
		expect(stale).toMatch(/<input[^>]*type="datetime-local"[^>]*disabled=""/);
	});
	it("version conflict notice preserves draft and clearly names destructive reload", () => {
		const html = renderToStaticMarkup(
			<TaskVersionNotice disabled onReload={() => {}} />,
		);
		expect(html).toContain("Your unsaved values are preserved");
		expect(html).toContain("discards unsaved values");
		expect(html).toContain('disabled=""');
	});
	it("history uses recorded name snapshots and before/after deadline evidence", () => {
		const html = renderToStaticMarkup(
			<TaskHistoryList
				task={task("a")}
				events={[
					{
						id: "change",
						actor: { id: "owner", name: "Creator" },
						action: "UPDATED",
						taskVersion: 2,
						createdAt: "2026-10-06T12:00:00Z",
						before: {
							assigneeId: "former",
							assigneeName: "Previous teammate",
							dueAt: null,
							completedAt: null,
						},
						after: {
							assigneeId: "assignee",
							assigneeName: "Recorded responsible name",
							dueAt: "2026-10-07T12:00:00Z",
							completedAt: null,
						},
					},
				]}
			/>,
		);
		expect(html).toContain("Changed by Creator");
		expect(html).toContain("Previous teammate");
		expect(html).toContain("Recorded responsible name");
		expect(html).toContain("No due date");
		expect(html).toContain("version 2");
	});
	it("legacy missing name snapshots use understandable fallback without prominent technical IDs", () => {
		const html = renderToStaticMarkup(
			<TaskHistoryList
				task={task("a")}
				events={[
					{
						id: "legacy",
						actor: { id: "owner", name: "Creator" },
						action: "CREATED",
						taskVersion: 0,
						createdAt: "2026-10-06T12:00:00Z",
						before: null,
						after: {
							assigneeId: "missingtechnicalid",
							assigneeName: null,
							dueAt: null,
							completedAt: null,
						},
					},
				]}
			/>,
		);
		expect(html).toContain("Former or unavailable member");
		expect(html).not.toContain("missingtechnicalid");
		expect(html).toContain("Older tasks may have");
	});
});
