import assert from "node:assert/strict";
import test from "node:test";
import {
	approvalDecisionPayload,
	mayDecideApproval,
} from "../app/(app)/[slug]/operations/approval-view-model.mjs";

const now = Date.parse("2026-09-14T12:00:00Z");
const row = {
	id: "ga_123",
	status: "PENDING",
	version: 2,
	payloadDigest: "a".repeat(64),
	expiresAt: "2026-09-14T12:30:00Z",
	canApprove: true,
	canReject: true,
	canCancel: true,
	legacyUnbound: false,
	snapshot: { previewComplete: true },
};
test("approval submission carries the exact current immutable snapshot, never tenant or action input", () => {
	assert.deepEqual(approvalDecisionPayload(row, "APPROVED", "Reviewed", now), {
		approvalId: row.id,
		expectedVersion: 2,
		expectedDigest: row.payloadDigest,
		decision: "APPROVED",
		reason: "Reviewed",
	});
});
test("expired, unbound, redacted or disabled snapshots cannot submit approval", () => {
	for (const changed of [
		{ expiresAt: new Date(now).toISOString() },
		{ legacyUnbound: true },
		{ snapshot: { previewComplete: false } },
		{ canApprove: false },
		{ version: -1 },
	]) {
		assert.equal(
			mayDecideApproval({ ...row, ...changed }, "APPROVED", now),
			false,
		);
		assert.throws(() =>
			approvalDecisionPayload({ ...row, ...changed }, "APPROVED", "", now),
		);
	}
});
test("only unconsumed consent may be revoked; terminal actions cannot be resubmitted", () => {
	assert.equal(
		mayDecideApproval({ ...row, status: "APPROVED" }, "CANCELLED", now),
		true,
	);
	for (const status of ["CONSUMED", "REJECTED", "EXPIRED", "CANCELLED"])
		assert.equal(
			mayDecideApproval({ ...row, status }, "CANCELLED", now),
			false,
		);
});
test("operator notes are bounded and no arbitrary decision is accepted", () => {
	assert.throws(() =>
		approvalDecisionPayload(row, "APPROVED", "x".repeat(501), now),
	);
	assert.equal(mayDecideApproval(row, "EXECUTE", now), false);
});
