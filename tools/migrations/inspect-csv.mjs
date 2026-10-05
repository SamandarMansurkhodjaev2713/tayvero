#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseCsv } from "../../packages/migration-core/src/index.mjs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node tools/migrations/inspect-csv.mjs <source.csv>");
  process.exitCode = 2;
} else {
  const text = await readFile(file, "utf8");
  const parsed = parseCsv(text, { delimiter: "auto" });
  process.stdout.write(`${JSON.stringify({ delimiter: parsed.delimiter === "\t" ? "TAB" : parsed.delimiter, headers: parsed.headers, rowCount: parsed.rows.length }, null, 2)}\n`);
}
