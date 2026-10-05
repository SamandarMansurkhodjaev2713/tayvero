#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../../", import.meta.url));
const ignore = new Set(["node_modules", ".git", ".next", "dist", ".turbo", "coverage"]);
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (ignore.has(entry.name)) return [];
    const file = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(file) : entry.isFile() && file.endsWith(".mjs") ? [file] : [];
  });
}
const files = walk(root), failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8", timeout: 10000 });
  if (result.status !== 0 || result.error) failures.push({ file: relative(root, file), error: result.stderr || result.error?.message || "Syntax checker failed" });
}
console.log(JSON.stringify({ checkedFiles: files.length, failures }, null, 2));
if (!files.length || failures.length) process.exitCode = 1;
