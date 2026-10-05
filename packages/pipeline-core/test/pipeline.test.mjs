
import assert from "node:assert/strict";
import test from "node:test";
import {
  PipelineDomainError,
  buildLegacyStageMigrationPlan,
  calculatePipelineAnalytics,
  normalizePipelineSlug,
  parsePipelineDefinition,
  planDealStageTransition,
} from "../src/index.mjs";

function pipeline(overrides = {}) {
  return {
    id: "pipeline-1",
    tenantId: "tenant-a",
    name: "New business",
    slug: "new-business",
    isDefault: true,
    isArchived: false,
    version: 1,
    stages: [
      { id: "new", key: "new", name: "New", position: 0, type: "OPEN", probabilityBps: 1000, color: "#112233", allowedFromStageIds: [] },
      { id: "qualified", key: "qualified", name: "Qualified", position: 1, type: "OPEN", probabilityBps: 5000, color: "#445566", allowedFromStageIds: ["new"] },
      { id: "won", key: "won", name: "Won", position: 2, type: "WON", probabilityBps: 10000, color: "#00aa00", allowedFromStageIds: ["qualified"] },
      { id: "lost", key: "lost", name: "Lost", position: 3, type: "LOST", probabilityBps: 0, color: "#aa0000", allowedFromStageIds: ["new", "qualified"] },
    ],
    ...overrides,
  };
}

function assignment(overrides = {}) {
  return { tenantId: "tenant-a", dealId: "deal-1", pipelineId: "pipeline-1", stageId: "new", version: 1, ...overrides };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof PipelineDomainError && error.code === code);
}

test("normalizes a safe pipeline slug", () => assert.equal(normalizePipelineSlug("  Enterprise Sales  "), "enterprise-sales"));
test("accepts a complete pipeline definition", () => assert.equal(parsePipelineDefinition(pipeline()).stages.length, 4));
test("rejects duplicate stage IDs", () => expectCode(() => parsePipelineDefinition(pipeline({ stages: pipeline().stages.map((stage, index) => index === 1 ? { ...stage, id: "new" } : stage) })), "DUPLICATE_STAGE_ID"));
test("rejects non-contiguous positions", () => expectCode(() => parsePipelineDefinition(pipeline({ stages: pipeline().stages.map((stage, index) => index === 1 ? { ...stage, position: 4 } : stage) })), "NON_CONTIGUOUS_POSITION"));
test("rejects invalid terminal probability", () => expectCode(() => parsePipelineDefinition(pipeline({ stages: pipeline().stages.map((stage) => stage.id === "won" ? { ...stage, probabilityBps: 9000 } : stage) })), "INVALID_WON_PROBABILITY"));
test("rejects an archived default pipeline", () => expectCode(() => parsePipelineDefinition(pipeline({ isArchived: true })), "ARCHIVED_DEFAULT_PIPELINE"));
test("plans an allowed transition with optimistic version increment", () => {
  const result = planDealStageTransition({ pipeline: pipeline(), assignment: assignment(), targetStageId: "qualified", expectedVersion: 1 });
  assert.equal(result.changed, true);
  assert.equal(result.assignment.stageId, "qualified");
  assert.equal(result.assignment.version, 2);
  assert.equal(result.event.type, "crm.deal.stage_changed");
});
test("treats same-stage movement as idempotent", () => {
  const result = planDealStageTransition({ pipeline: pipeline(), assignment: assignment(), targetStageId: "new", expectedVersion: 1 });
  assert.equal(result.changed, false);
  assert.equal(result.event, null);
});
test("rejects a transition that violates stage rules", () => expectCode(() => planDealStageTransition({ pipeline: pipeline(), assignment: assignment(), targetStageId: "won", expectedVersion: 1 }), "TRANSITION_NOT_ALLOWED"));
test("rejects stale optimistic version", () => expectCode(() => planDealStageTransition({ pipeline: pipeline(), assignment: assignment({ version: 2 }), targetStageId: "qualified", expectedVersion: 1 }), "STALE_ASSIGNMENT"));
test("rejects cross-tenant assignment", () => expectCode(() => planDealStageTransition({ pipeline: pipeline(), assignment: assignment({ tenantId: "tenant-b" }), targetStageId: "qualified", expectedVersion: 1 }), "TENANT_MISMATCH"));
test("requires explicit permission to reopen a terminal deal", () => expectCode(() => planDealStageTransition({ pipeline: pipeline(), assignment: assignment({ stageId: "lost" }), targetStageId: "new", expectedVersion: 1 }), "REOPEN_REQUIRES_EXPLICIT_PERMISSION"));
test("allows an explicitly authorized terminal reopen", () => {
  const result = planDealStageTransition({ pipeline: pipeline(), assignment: assignment({ stageId: "lost" }), targetStageId: "new", expectedVersion: 1, allowReopen: true });
  assert.equal(result.assignment.stageId, "new");
});
test("builds deterministic legacy assignments", () => {
  const result = buildLegacyStageMigrationPlan({ pipeline: pipeline(), deals: [{ id: "d1", tenantId: "tenant-a", legacyStage: "DEMO_BOOKED" }, { id: "d2", tenantId: "tenant-a", legacyStage: "CLOSED_WON" }], mapping: { DEMO_BOOKED: "new", CLOSED_WON: "won" } });
  assert.equal(result.count, 2);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
});
test("fails closed when a legacy stage has no mapping", () => expectCode(() => buildLegacyStageMigrationPlan({ pipeline: pipeline(), deals: [{ id: "d1", tenantId: "tenant-a", legacyStage: "UNKNOWN" }], mapping: {} }), "UNMAPPED_LEGACY_STAGE"));
test("calculates exact minor-unit analytics without floating point", () => {
  const result = calculatePipelineAnalytics({
    pipeline: pipeline(),
    now: "2026-08-31T12:00:00.000Z",
    deals: [
      { id: "d1", tenantId: "tenant-a", stageId: "new", amountMinor: "900719925474099312345", enteredStageAt: "2026-08-31T11:00:00.000Z" },
      { id: "d2", tenantId: "tenant-a", stageId: "new", amountMinor: "55", enteredStageAt: "2026-08-31T10:00:00.000Z" },
    ],
  });
  const stage = result.stages.find((item) => item.stageId === "new");
  assert.equal(stage.totalAmountMinor, "900719925474099312400");
  assert.equal(stage.averageStageAgeSeconds, 5400);
});
