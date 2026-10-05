#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parsePipelineDefinition } from "../../packages/pipeline-core/src/index.mjs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node tools/pipelines/validate-definition.mjs <pipeline.json>");
  process.exitCode = 2;
} else {
  const source = JSON.parse(await readFile(file, "utf8"));
  const pipeline = parsePipelineDefinition(source);
  process.stdout.write(`${JSON.stringify(pipeline, null, 2)}\n`);
}
