const KINDS = new Set(["OPEN", "WON", "LOST"]);
function assertText(value, name) { if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be non-empty`); }

export function validatePipelineDefinition(pipeline) {
  assertText(pipeline?.id, "pipeline.id"); assertText(pipeline?.name, "pipeline.name");
  if (!Array.isArray(pipeline.stages) || pipeline.stages.length < 2 || pipeline.stages.length > 100) throw new RangeError("pipeline must contain 2..100 stages");
  const ids = new Set(); const positions = new Set(); let open = 0; let terminal = 0;
  for (const stage of pipeline.stages) {
    assertText(stage.id, "stage.id"); assertText(stage.name, "stage.name");
    if (ids.has(stage.id)) throw new TypeError(`duplicate stage id: ${stage.id}`); ids.add(stage.id);
    if (!Number.isInteger(stage.position) || stage.position < 0) throw new TypeError("stage.position must be a non-negative integer");
    if (positions.has(stage.position)) throw new TypeError(`duplicate stage position: ${stage.position}`); positions.add(stage.position);
    if (!KINDS.has(stage.kind)) throw new TypeError(`invalid stage kind: ${stage.kind}`);
    if (!Number.isInteger(stage.probabilityBps) || stage.probabilityBps < 0 || stage.probabilityBps > 10_000) throw new RangeError("stage probability must be 0..10000 basis points");
    if (stage.kind === "WON" && stage.probabilityBps !== 10_000) throw new TypeError("WON stage probability must equal 10000");
    if (stage.kind === "LOST" && stage.probabilityBps !== 0) throw new TypeError("LOST stage probability must equal 0");
    if (stage.kind === "OPEN") open += 1; else terminal += 1;
  }
  if (open === 0 || terminal === 0) throw new TypeError("pipeline requires at least one OPEN and one terminal stage");
  return Object.freeze({ ...pipeline, stages: [...pipeline.stages].sort((a, b) => a.position - b.position).map(Object.freeze) });
}

export function evaluateStageTransition({ pipeline, fromStageId, toStageId, allowReopen = false, allowedTransitions }) {
  const definition = validatePipelineDefinition(pipeline);
  const from = definition.stages.find((stage) => stage.id === fromStageId);
  const to = definition.stages.find((stage) => stage.id === toStageId);
  if (!from || !to) return { allowed: false, code: "STAGE_NOT_FOUND" };
  if (from.id === to.id) return { allowed: true, code: "IDEMPOTENT_NO_CHANGE" };
  if (from.kind !== "OPEN" && to.kind === "OPEN" && !allowReopen) return { allowed: false, code: "TERMINAL_REOPEN_DENIED" };
  if (Array.isArray(allowedTransitions)) {
    const key = `${from.id}->${to.id}`;
    if (!allowedTransitions.includes(key)) return { allowed: false, code: "TRANSITION_NOT_ALLOWED" };
  }
  return { allowed: true, code: "ALLOWED", from, to };
}
