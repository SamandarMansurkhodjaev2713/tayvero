
import { fail } from "./errors.mjs";

const STAGE_TYPES = new Set(["OPEN", "WON", "LOST"]);
const SAFE_KEY = /^[a-z][a-z0-9_]{0,62}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const RESERVED_STAGE_KEY_PREFIX = "zz_internal_";
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertRecord(value, path) {
  if (!isRecord(value)) fail("INVALID_OBJECT", `${path} must be a plain object`, { path });
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) fail("UNSAFE_KEY", `${path} contains an unsafe key`, { path, key });
  }
  return value;
}

function text(value, path, { min = 1, max = 255 } = {}) {
  if (typeof value !== "string") fail("INVALID_STRING", `${path} must be a string`, { path });
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    fail("STRING_LENGTH", `${path} length is outside the accepted range`, { path, min, max });
  }
  return normalized;
}

function integer(value, path, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail("INVALID_INTEGER", `${path} must be a safe integer in range`, { path, min, max });
  }
  return value;
}

function boolean(value, path) {
  if (typeof value !== "boolean") fail("INVALID_BOOLEAN", `${path} must be a boolean`, { path });
  return value;
}

export function normalizePipelineSlug(value) {
  const normalized = text(value, "pipeline.slug", { max: 64 })
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!normalized || normalized.length > 64) {
    fail("INVALID_SLUG", "pipeline.slug cannot be normalized to a safe slug");
  }
  return normalized;
}

function normalizeStage(input, index) {
  const value = assertRecord(input, `pipeline.stages[${index}]`);
  const id = text(value.id, `pipeline.stages[${index}].id`, { max: 128 });
  const key = text(value.key, `pipeline.stages[${index}].key`, { max: 63 }).toLowerCase();
  if (!SAFE_KEY.test(key) || key.startsWith(RESERVED_STAGE_KEY_PREFIX)) {
    fail("INVALID_STAGE_KEY", "Stage key must use non-reserved snake_case ASCII", { index, key });
  }
  const type = text(value.type, `pipeline.stages[${index}].type`, { max: 16 }).toUpperCase();
  if (!STAGE_TYPES.has(type)) fail("INVALID_STAGE_TYPE", "Unknown pipeline stage type", { index, type });
  const probabilityBps = integer(value.probabilityBps, `pipeline.stages[${index}].probabilityBps`, { min: 0, max: 10_000 });
  if (type === "WON" && probabilityBps !== 10_000) fail("INVALID_WON_PROBABILITY", "WON stage probability must be 10000 bps", { id });
  if (type === "LOST" && probabilityBps !== 0) fail("INVALID_LOST_PROBABILITY", "LOST stage probability must be 0 bps", { id });
  if (type === "OPEN" && probabilityBps === 10_000) fail("INVALID_OPEN_PROBABILITY", "OPEN stage probability must be below 10000 bps", { id });

  const color = value.color == null ? null : text(value.color, `pipeline.stages[${index}].color`, { max: 7 });
  if (color !== null && !HEX_COLOR.test(color)) fail("INVALID_STAGE_COLOR", "Stage color must be a six-digit hex color", { id, color });

  const allowedFromStageIds = value.allowedFromStageIds == null ? [] : value.allowedFromStageIds;
  if (!Array.isArray(allowedFromStageIds)) fail("INVALID_TRANSITIONS", "allowedFromStageIds must be an array", { id });
  const normalizedAllowed = allowedFromStageIds.map((item, allowedIndex) => text(item, `pipeline.stages[${index}].allowedFromStageIds[${allowedIndex}]`, { max: 128 }));
  if (new Set(normalizedAllowed).size !== normalizedAllowed.length) fail("DUPLICATE_TRANSITION", "allowedFromStageIds contains duplicates", { id });

  return Object.freeze({
    id,
    key,
    name: text(value.name, `pipeline.stages[${index}].name`, { max: 120 }),
    position: integer(value.position, `pipeline.stages[${index}].position`, { min: 0, max: 10_000 }),
    type,
    probabilityBps,
    color,
    allowedFromStageIds: Object.freeze(normalizedAllowed),
  });
}

export function parsePipelineDefinition(input) {
  const value = assertRecord(input, "pipeline");
  if (!Array.isArray(value.stages)) fail("INVALID_STAGES", "pipeline.stages must be an array");
  if (value.stages.length < 3 || value.stages.length > 200) {
    fail("STAGE_COUNT", "A pipeline must have between 3 and 200 stages", { count: value.stages.length });
  }
  const stages = value.stages.map(normalizeStage).sort((a, b) => a.position - b.position);
  const ids = stages.map((stage) => stage.id);
  const keys = stages.map((stage) => stage.key);
  if (new Set(ids).size !== ids.length) fail("DUPLICATE_STAGE_ID", "Stage IDs must be unique");
  if (new Set(keys).size !== keys.length) fail("DUPLICATE_STAGE_KEY", "Stage keys must be unique");
  stages.forEach((stage, index) => {
    if (stage.position !== index) fail("NON_CONTIGUOUS_POSITION", "Stage positions must be contiguous and zero-based", { stageId: stage.id, expected: index, actual: stage.position });
    for (const sourceId of stage.allowedFromStageIds) {
      if (!ids.includes(sourceId)) fail("UNKNOWN_TRANSITION_SOURCE", "Transition references an unknown stage", { stageId: stage.id, sourceId });
      if (sourceId === stage.id) fail("SELF_TRANSITION_RULE", "A stage cannot explicitly allow itself as a transition source", { stageId: stage.id });
    }
  });
  if (!stages.some((stage) => stage.type === "OPEN")) fail("MISSING_OPEN_STAGE", "Pipeline requires at least one OPEN stage");
  if (!stages.some((stage) => stage.type === "WON")) fail("MISSING_WON_STAGE", "Pipeline requires at least one WON stage");
  if (!stages.some((stage) => stage.type === "LOST")) fail("MISSING_LOST_STAGE", "Pipeline requires at least one LOST stage");

  const isDefault = boolean(value.isDefault ?? false, "pipeline.isDefault");
  const isArchived = boolean(value.isArchived ?? false, "pipeline.isArchived");
  if (isDefault && isArchived) fail("ARCHIVED_DEFAULT_PIPELINE", "An archived pipeline cannot remain the default");

  return Object.freeze({
    id: text(value.id, "pipeline.id", { max: 128 }),
    tenantId: text(value.tenantId, "pipeline.tenantId", { max: 128 }),
    name: text(value.name, "pipeline.name", { max: 120 }),
    slug: normalizePipelineSlug(value.slug),
    isDefault,
    isArchived,
    version: integer(value.version ?? 1, "pipeline.version", { min: 1 }),
    stages: Object.freeze(stages),
  });
}

export function parseAssignment(input, path = "assignment") {
  const value = assertRecord(input, path);
  return Object.freeze({
    tenantId: text(value.tenantId, `${path}.tenantId`, { max: 128 }),
    dealId: text(value.dealId, `${path}.dealId`, { max: 128 }),
    pipelineId: text(value.pipelineId, `${path}.pipelineId`, { max: 128 }),
    stageId: text(value.stageId, `${path}.stageId`, { max: 128 }),
    version: integer(value.version, `${path}.version`, { min: 1 }),
  });
}
