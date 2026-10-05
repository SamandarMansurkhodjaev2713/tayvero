import assert from "node:assert/strict";
import test from "node:test";
import {
	createPrismaApprovalLifecycle,
	sha256Hex,
} from "@crm/agent-action-runtime";
import { createApprovalContinuationStore } from "../../../packages/agent-action-runtime/src/approval-continuation.mjs";
import { migrationPrismaDouble } from "./helpers/migration-prisma-double.mjs";

const code = (promise, value) =>
	assert.rejects(promise, (e) => e.code === value);
function fixture() {
	let ms = Date.parse("2026-09-15T10:00:00Z");
	const clock = () => new Date(ms);
	const f = migrationPrismaDouble({
		member: [
			{ organizationId: "ws", userId: "author", role: "admin" },
			{ organizationId: "ws", userId: "reviewer", role: "owner" },
		],
		agentRun: [
			{
				id: "run-1",
				agentId: "agent-1",
				versionId: "version-1",
				initiatedById: "author",
				status: "RUNNING",
				sessionId: "root-1",
				startedAt: clock(),
				cancelRequestedAt: null,
				approvalWaitStartedAt: null,
				approvalExecutionDeadlineAt: null,
			},
		],
		agentVersion: [
			{ id: "version-1", createdById: "author", agentId: "agent-1" },
		],
		agentDefinition: [{ id: "agent-1", status: "LIVE" }],
	});
	const approvals = createPrismaApprovalLifecycle({
		prisma: f.db,
		workspaceId: "ws",
		clock,
		ttlMs: 60000,
	});
	const make = () =>
		createApprovalContinuationStore({
			prisma: f.db,
			workspaceId: "ws",
			clock,
			deliveryLeaseMs: 1000,
			executionBudgetMs: 20000,
		});
	const store = make();
	async function prepare(callId = "call-1") {
		const input = { runId: "run-1", callId, text: "Approved exact message" };
		const digest = sha256Hex({
			tenantId: "ws",
			actionId: "slack.message.post",
			manifestVersion: "1.0.0",
			input,
		});
		const ap = await approvals.request({
			context: {
				tenantId: "ws",
				actorId: "agent-run:run-1",
				requestId: `agent-action:run-1:${callId}`,
				correlationId: "cor-1",
			},
			actionId: "slack.message.post",
			manifestVersion: "1.0.0",
			executionKey: `run-1:${callId}`,
			input,
			digest,
			risk: "MEDIUM",
			mutating: true,
		});
		const q = {
			runId: "run-1",
			sessionId: "child-1",
			callId,
			payloadDigest: digest,
			toolName: "post_slack_message",
			approvalId: ap.id,
		};
		const ticket = await store.prepare(q);
		return { ap, q, ticket };
	}
	async function bind(p, extra = {}) {
		return store.bind({
			...p.q,
			requestId: `native-${p.q.callId}`,
			turnId: "turn-1",
			sequence: 0,
			eventId: `input-${p.q.callId}`,
			...extra,
		});
	}
	const park = (eventId = "wait-1") =>
		store.park({ runId: "run-1", sessionId: "child-1", eventId });
	const decide = (p, decision = "APPROVED") =>
		approvals.decide(
			{ tenantId: "ws", actorId: "reviewer" },
			{
				approvalId: p.ap.id,
				expectedVersion: p.ap.version,
				expectedDigest: p.ap.payloadDigest,
				decision,
			},
		);
	return {
		...f,
		clock,
		store,
		make,
		prepare,
		bind,
		park,
		decide,
		advance: (n) => (ms += n),
	};
}

test("native child/session/call binding is durable across fresh service instances", async () => {
	const f = fixture();
	const p = await f.prepare();
	assert.equal(f.state.agentRun[0].status, "RUNNING");
	assert.equal((await f.make().prepare(p.q)).id, p.ticket.id);
	assert.equal(f.state.governedActionContinuation.length, 1);
	await f.bind(p);
	await f.park();
	assert.equal(f.state.agentRun[0].status, "WAITING_FOR_APPROVAL");
	await f.decide(p);
	let sent;
	const result = await f.make().dispatch(p.ticket.id, async (q) => {
		sent = q;
		await f.store.admitDelivery(q);
		return { sessionId: q.sessionId };
	});
	assert.equal(result.status, "DELIVERED");
	assert.equal(sent.sessionId, "child-1");
	assert.equal(sent.rootSessionId, "root-1");
	assert.equal(sent.requestId, "native-call-1");
	assert.equal(sent.callId, "call-1");
	assert.equal(sent.decision, "approve");
	assert.equal(f.state.governedActionApproval[0].status, "APPROVED"); // dispatch does not consume or execute
	await f.store.assertExecution(p.q);
});

test("consent alone cannot resume before durable native input and waiting boundary", async () => {
	const f = fixture();
	const p = await f.prepare();
	await f.decide(p);
	assert.equal(await f.store.claim(p.ticket.id), null);
	await f.bind(p);
	assert.equal(await f.store.claim(p.ticket.id), null);
	await f.park();
	assert.ok(await f.store.claim(p.ticket.id));
});

test("pending consent parks without dispatch and polling is bounded/fair", async () => {
	const f = fixture();
	const p = await f.prepare();
	await f.bind(p);
	await f.park();
	assert.deepEqual(await f.store.candidates(), [p.ticket.id]);
	assert.equal(await f.store.claim(p.ticket.id), null);
	assert.deepEqual(await f.store.candidates(), []);
	assert.equal(f.state.agentRun[0].status, "WAITING_FOR_APPROVAL");
});

test("wrong session, actor workspace, payload, call and native request cannot rebind consent", async () => {
	const f = fixture();
	const p = await f.prepare();
	await code(
		f.store.prepare({ ...p.q, sessionId: "child-other" }),
		"CONTINUATION_BINDING_MISMATCH",
	);
	await code(
		f.bind(p, { payloadDigest: "0".repeat(64) }),
		"CONTINUATION_BINDING_MISMATCH",
	);
	await code(
		f.bind(p, { sessionId: "wrong" }),
		"CONTINUATION_BINDING_MISMATCH",
	);
	await f.bind(p);
	await f.bind(p);
	await code(
		f.bind(p, { requestId: "re-emitted-different" }),
		"CONTINUATION_NATIVE_REQUEST_CHANGED",
	);
	assert.equal(
		f.state.governedActionContinuation[0].status,
		"RECONCILIATION_REQUIRED",
	);
	assert.equal(await f.store.claim(p.ticket.id), null);
	const other = createApprovalContinuationStore({
		prisma: f.db,
		workspaceId: "other",
		clock: f.clock,
	});
	await code(other.claim(p.ticket.id), "CONTINUATION_NOT_FOUND");
	f.state.agentRun[0].versionId = "new-version";
	await code(f.bind(p), "CONTINUATION_BINDING_MISMATCH");
});

test("two dispatchers cannot both submit one approval or two calls of the same waiting run", async () => {
	const f = fixture();
	const a = await f.prepare("call-a"),
		b = await f.prepare("call-b");
	await f.bind(a);
	await f.bind(b);
	await f.park();
	await f.decide(a);
	await f.decide(b);
	const claims = await Promise.all([
		f.store.claim(a.ticket.id),
		f.make().claim(a.ticket.id),
		f.make().claim(b.ticket.id),
	]);
	assert.equal(claims.filter(Boolean).length, 1);
});

test("lost transport acknowledgement is quarantined; never whole-run/new-key replay", async () => {
	const f = fixture();
	const p = await f.prepare();
	await f.bind(p);
	await f.park();
	await f.decide(p);
	let sends = 0;
	const result = await f.store.dispatch(p.ticket.id, async () => {
		sends++;
		throw new Error("accepted but connection dropped");
	});
	assert.equal(result.status, "RECONCILIATION_REQUIRED");
	assert.equal(
		(
			await f.make().dispatch(p.ticket.id, async () => {
				sends++;
			})
		).status,
		"NOT_CLAIMED",
	);
	assert.equal(sends, 1);
	await code(
		f.store.assertExecution(p.q),
		"CONTINUATION_REQUIRES_RECONCILIATION",
	);
});

test("crashed dispatcher lease is quarantined, not reacquired", async () => {
	const f = fixture();
	const p = await f.prepare();
	await f.bind(p);
	await f.park();
	await f.decide(p);
	const claim = await f.store.claim(p.ticket.id);
	f.advance(1001);
	assert.deepEqual(await f.make().candidates(), []);
	assert.equal(
		f.state.governedActionContinuation[0].status,
		"RECONCILIATION_REQUIRED",
	);
	assert.equal(
		await f.store.settleDelivery(claim, { acceptedSessionId: "child-1" }),
		"RECONCILIATION_REQUIRED",
	);
});

test("exact-session mismatch in transport acknowledgement fails closed", async () => {
	const f = fixture();
	const p = await f.prepare();
	await f.bind(p);
	await f.park();
	await f.decide(p);
	const result = await f.store.dispatch(p.ticket.id, async () => ({
		sessionId: "replacement-root",
	}));
	assert.equal(result.status, "RECONCILIATION_REQUIRED");
	assert.equal(f.state.agentRun[0].sessionId, "root-1");
});

test("expired/rejected/cancelled approval resumes only a native denial", async () => {
	for (const state of ["EXPIRED", "REJECTED", "CANCELLED"]) {
		const f = fixture();
		const p = await f.prepare();
		await f.bind(p);
		await f.park();
		if (state === "EXPIRED") f.advance(60001);
		else await f.decide(p, state);
		const q = await f.store.claim(p.ticket.id);
		assert.equal(q.decision, "deny");
		await code(f.store.assertExecution(p.q), "CONTINUATION_EXECUTION_BLOCKED");
	}
});

test("revoked approver denies; revoked requester quarantines; cancellation never dispatches", async () => {
	const a = fixture();
	const p = await a.prepare();
	await a.bind(p);
	await a.park();
	await a.decide(p);
	a.state.member = a.state.member.filter((m) => m.userId !== "reviewer");
	assert.equal((await a.store.claim(p.ticket.id)).decision, "deny");
	const b = fixture();
	const q = await b.prepare();
	await b.bind(q);
	await b.park();
	await b.decide(q);
	b.state.member = b.state.member.filter((m) => m.userId !== "author");
	assert.equal(await b.store.claim(q.ticket.id), null);
	assert.equal(
		b.state.governedActionContinuation[0].errorCode,
		"REQUESTER_AUTHORITY_REVOKED",
	);
	const c = fixture();
	const r = await c.prepare();
	await c.bind(r);
	await c.park();
	c.state.agentRun[0].cancelRequestedAt = c.clock();
	assert.equal(await c.store.claim(r.ticket.id), null);
	assert.equal(c.state.governedActionContinuation[0].status, "CANCELLED");
});

test("approval waiting extends only execution deadline; original startedAt is preserved", async () => {
	const f = fixture();
	const p = await f.prepare();
	const started = f.state.agentRun[0].startedAt;
	f.advance(5000);
	await f.bind(p);
	await f.park();
	f.advance(10000);
	await f.decide(p);
	await f.store.claim(p.ticket.id);
	assert.deepEqual(f.state.agentRun[0].startedAt, started);
	assert.equal(
		f.state.agentRun[0].approvalExecutionDeadlineAt.getTime(),
		started.getTime() + 30000,
	);
	assert.equal(f.state.agentRun[0].approvalWaitStartedAt, null);
});

test("replayed waiting event cannot park a resumed run again", async () => {
	const f = fixture();
	const a = await f.prepare("call-a"),
		b = await f.prepare("call-b");
	await f.bind(a);
	await f.bind(b);
	await f.park();
	await f.decide(a);
	await f.store.claim(a.ticket.id);
	assert.equal(await f.park(), false);
	assert.equal(f.state.agentRun[0].status, "RUNNING");
});

test("audit failure rolls back waiting/dispatch state and produces no delivery", async () => {
	const f = fixture();
	const p = await f.prepare();
	await f.bind(p);
	await f.park();
	await f.decide(p);
	let sends = 0;
	f.setHook((m, o) => {
		if (m === "governedActionAuditEvent" && o === "create")
			throw new Error("audit down");
	});
	await assert.rejects(
		f.store.dispatch(p.ticket.id, async () => {
			sends++;
			return { sessionId: "child-1" };
		}),
	);
	assert.equal(sends, 0);
	assert.equal(f.state.agentRun[0].status, "WAITING_FOR_APPROVAL");
	assert.equal(f.state.governedActionContinuation[0].status, "READY");
});

test("only a successful matching governed receipt closes observed execution", async () => {
	const f = fixture();
	const p = await f.prepare();
	await f.bind(p);
	await f.park();
	await f.decide(p);
	await f.store.claim(p.ticket.id);
	assert.equal(await f.store.observeSuccess(p.q), false);
	f.state.governedActionReceipt.push({
		id: "receipt-1",
		workspaceId: "ws",
		actionId: "slack.message.post",
		idempotencyKey: "ws:slack.message.post:run-1:call-1",
		payloadDigest: p.q.payloadDigest,
		status: "SUCCEEDED",
	});
	assert.equal(await f.store.observeSuccess(p.q), true);
	assert.equal(f.state.governedActionContinuation[0].status, "COMPLETED");
	assert.equal(await f.make().observeSuccess(p.q), true);
});

test("native HTTP admission is one-use and rechecks fresh authority without consuming business consent", async () => {
	const f = fixture();
	const p = await f.prepare();
	await f.bind(p);
	await f.park();
	await f.decide(p);
	const q = await f.store.claim(p.ticket.id);
	assert.equal((await f.store.admitDelivery(q)).userId, "author");
	assert.equal(await f.make().admitDelivery(q), null);
	assert.equal(f.state.governedActionApproval[0].status, "APPROVED");
});
test("late expiry/revocation/cancellation at native admission cannot use earlier dispatch authority", async () => {
	for (const mode of ["expire", "revoke", "cancel"]) {
		const f = fixture();
		const p = await f.prepare();
		await f.bind(p);
		await f.park();
		await f.decide(p);
		const q = await f.store.claim(p.ticket.id);
		if (mode === "expire") f.advance(60001);
		if (mode === "revoke")
			f.state.member = f.state.member.filter((x) => x.userId !== "reviewer");
		if (mode === "cancel") f.state.agentRun[0].cancelRequestedAt = f.clock();
		if (mode === "cancel") await assert.rejects(f.store.admitDelivery(q));
		else assert.equal(await f.store.admitDelivery(q), null);
		assert.equal(
			f.state.governedActionContinuation[0].transportAdmittedAt,
			null,
		);
	}
});
test("execution budget already exhausted before waiting is not restored by approval", async () => {
	const f = fixture();
	const p = await f.prepare();
	f.advance(21000);
	await f.bind(p);
	await f.park();
	await f.decide(p);
	assert.equal(await f.store.claim(p.ticket.id), null);
	assert.equal(
		f.state.governedActionContinuation[0].errorCode,
		"RUN_WAIT_BUDGET_INVALID",
	);
});

test("scheduled continuation preserves the dispatch principal, never the immutable version editor", async () => {
	const f = fixture();
	f.state.agentRun[0].initiatedById = null;
	f.state.agentRun[0].principalId = "author";
	f.state.agentDefinition[0].createdById = "author";
	f.state.agentVersion[0].createdById = "different-version-editor";
	const p = await f.prepare();
	assert.equal(f.state.governedActionApproval[0].requesterUserId, "author");
	await f.bind(p);
	await f.park();
	await f.decide(p);
	const claim = await f.store.claim(p.ticket.id);
	assert.equal(claim.authority.userId, "author");
	assert.equal(claim.authority.authenticator, "crm-schedule");
	assert.equal(claim.authority.principalType, "runtime");
});
test("historical scheduled run principal follows original dispatch, and contradictory manual identity is denied", async () => {
	const f = fixture();
	f.state.agentRun[0].initiatedById = null;
	f.state.agentDefinition[0].createdById = "author";
	f.state.agentVersion[0].createdById = "different-version-editor";
	const p = await f.prepare();
	assert.equal(f.state.governedActionApproval[0].requesterUserId, "author");
	f.state.agentRun[0].initiatedById = "reviewer";
	f.state.agentRun[0].principalId = "author";
	await code(f.store.prepare(p.q), "CONTINUATION_FORBIDDEN");
});
