import assert from "node:assert/strict";
import test from "node:test";
import {
  Money, Risk, calculateAutomationRoi, calculateDealHealth, canonicalJson,
  createApprovalPayloadHash, createContactDedupKey, createIdempotencyKey,
  evaluateAgentAction, evaluateStageTransition, isForbiddenIp, mapImportRow,
  normalizeEmail, normalizePhone, resolveAndValidateOutboundUrl, retry,
  validateOutboundUrl, validatePipelineDefinition,
} from "../src/index.mjs";

test("canonical JSON is stable across object key order", () => {
  assert.equal(canonicalJson({ b: 2, a: { y: 2, x: 1 } }), canonicalJson({ a: { x: 1, y: 2 }, b: 2 }));
  assert.throws(() => canonicalJson({ value: undefined }), /undefined/);
});

test("idempotency key is deterministic and tenant scoped", () => {
  const first = createIdempotencyKey({ tenantId: "t1", action: "crm.task.create", payload: { b: 2, a: 1 } });
  const second = createIdempotencyKey({ tenantId: "t1", action: "crm.task.create", payload: { a: 1, b: 2 } });
  const otherTenant = createIdempotencyKey({ tenantId: "t2", action: "crm.task.create", payload: { a: 1, b: 2 } });
  assert.equal(first, second); assert.notEqual(first, otherTenant);
});

test("money avoids floating point and uses explicit rounding", () => {
  const amount = Money.fromDecimal("123.45", "USD", 2);
  assert.equal(amount.toDecimalString(), "123.45");
  assert.equal(amount.multiplyBasisPoints(1_250).toDecimalString(), "15.43");
  assert.equal(Money.fromDecimal("-0.05", "USD").multiplyBasisPoints(5_000).toDecimalString(), "-0.03");
  assert.throws(() => Money.fromDecimal("1.001", "USD", 2), /fractional/);
  assert.throws(() => amount.add(Money.fromDecimal("1", "UZS")), /match/);
});

test("agent policy is deny by default and approval is payload-bound", () => {
  const policy = { allowedActions: ["crm.deal.*"], deniedActions: ["crm.deal.delete"], maxActionCostMinor: "1000" };
  const base = { tenantId: "tenant", action: "crm.deal.update", resourceId: "deal-1", payload: { amount: "50000" }, risk: Risk.BUSINESS_STATE_CHANGE, environment: "production", estimatedCostMinor: "3" };
  const required = evaluateAgentAction(policy, base, new Date("2026-01-01T00:00:00Z"));
  assert.equal(required.decision, "REQUIRE_APPROVAL");
  const allowed = evaluateAgentAction(policy, { ...base, approval: { id: "a1", payloadHash: required.payloadHash, approverAuthorized: true, expiresAt: "2026-01-02T00:00:00Z" } }, new Date("2026-01-01T00:00:00Z"));
  assert.equal(allowed.decision, "ALLOW");
  const tampered = evaluateAgentAction(policy, { ...base, payload: { amount: "60000" }, approval: { id: "a1", payloadHash: required.payloadHash, approverAuthorized: true, expiresAt: "2026-01-02T00:00:00Z" } }, new Date("2026-01-01T00:00:00Z"));
  assert.equal(tampered.code, "APPROVAL_PAYLOAD_MISMATCH");
  assert.equal(evaluateAgentAction(policy, { ...base, action: "crm.deal.delete", risk: Risk.IRREVERSIBLE }).code, "EXPLICIT_DENY");
});

test("retry is bounded and uses injected deterministic sleep", async () => {
  let calls = 0; const delays = [];
  const result = await retry(async () => { calls += 1; if (calls < 3) throw new Error("transient"); return "ok"; }, {
    maxAttempts: 3, baseDelayMs: 10, jitterRatio: 0, shouldRetry: () => true, sleep: async (ms) => { delays.push(ms); },
  });
  assert.equal(result, "ok"); assert.equal(calls, 3); assert.deepEqual(delays, [10, 20]);
});

test("integration URL policy blocks local, credential and rebinding targets", async () => {
  assert.throws(() => validateOutboundUrl("http://example.com"), /Protocol/);
  assert.throws(() => validateOutboundUrl("https://user:pass@example.com"), /Credentials/);
  assert.throws(() => validateOutboundUrl("https://127.0.0.1/hook"), /private/);
  assert.equal(isForbiddenIp("10.0.0.1"), true); assert.equal(isForbiddenIp("8.8.8.8"), false);
  await assert.rejects(() => resolveAndValidateOutboundUrl("https://safe.example/hook", {}, async () => [{ address: "169.254.169.254", family: 4 }]), /private/);
  const valid = await resolveAndValidateOutboundUrl("https://safe.example/hook", {}, async () => [{ address: "8.8.8.8", family: 4 }]);
  assert.equal(valid.hostname, "safe.example");
});

test("pipeline validates terminal semantics and transition policy", () => {
  const pipeline = validatePipelineDefinition({ id: "sales", name: "Sales", stages: [
    { id: "new", name: "New", position: 0, kind: "OPEN", probabilityBps: 1000 },
    { id: "won", name: "Won", position: 1, kind: "WON", probabilityBps: 10000 },
    { id: "lost", name: "Lost", position: 2, kind: "LOST", probabilityBps: 0 },
  ] });
  assert.equal(evaluateStageTransition({ pipeline, fromStageId: "new", toStageId: "won" }).allowed, true);
  assert.equal(evaluateStageTransition({ pipeline, fromStageId: "won", toStageId: "new" }).code, "TERMINAL_REOPEN_DENIED");
});

test("deal health returns deterministic evidence factors", () => {
  const result = calculateDealHealth({ now: "2026-08-30T00:00:00Z", lastMeaningfulActivityAt: "2026-08-20T00:00:00Z", stageEnteredAt: "2026-08-01T00:00:00Z", hasNextStep: false, hasDecisionMaker: false, hasChampion: true, overdueTaskCount: 2, communicationTrend: "DECLINING", requiredFieldCompletenessBps: 7000 });
  assert.equal(result.band, "AT_RISK"); assert.ok(result.factors.some((factor) => factor.code === "INACTIVITY")); assert.equal(result.evidenceVersion, "deterministic-v1");
});

test("contact normalization supports Uzbekistan and safe mapping errors", () => {
  assert.equal(normalizeEmail(" User@Example.COM "), "user@example.com");
  assert.equal(normalizePhone("90 123 45 67"), "+998901234567");
  assert.equal(createContactDedupKey({ email: "A@EXAMPLE.COM" }), "email:a@example.com");
  const mapped = mapImportRow({ Mail: "broken", Phone: "123" }, { email: "Mail", phone: "Phone" });
  assert.deepEqual(mapped.errors.map((error) => error.code).sort(), ["INVALID_EMAIL", "INVALID_PHONE"]);
});

test("ROI calculation uses integer arithmetic", () => {
  const result = calculateAutomationRoi({ employees: 20, workdaysPerMonth: 22, savedMinutesPerEmployeePerDay: 45, workingMinutesPerEmployeePerMonth: 10_560, monthlyEmployeeCostMinor: "1000000000", platformCostMinor: "100000000", recoveredRevenueMinor: "0" });
  assert.equal(result.savedMinutes, "19800"); assert.ok(BigInt(result.laborSavedMinor) > 0n); assert.ok(BigInt(result.netBenefitMinor) > 0n);
});

test("approval payload hash changes when action data changes", () => {
  const a = createApprovalPayloadHash({ tenantId: "t", action: "send", resourceId: "r", payload: { body: "a" } });
  const b = createApprovalPayloadHash({ tenantId: "t", action: "send", resourceId: "r", payload: { body: "b" } });
  assert.notEqual(a, b);
});
