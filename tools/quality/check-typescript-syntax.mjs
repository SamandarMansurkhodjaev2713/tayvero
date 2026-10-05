#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";

const root = resolve(process.cwd());
const require = createRequire(import.meta.url);
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);
const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

function isTypeScriptFile(file) {
  return TYPESCRIPT_EXTENSIONS.some((extension) => file.endsWith(extension));
}

function walk(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, output);
    else if (entry.isFile() && isTypeScriptFile(absolute)) output.push(absolute);
  }
  return output;
}

function localTypeScript() {
  try {
    return require("typescript");
  } catch {
    return null;
  }
}

function globalTypeScript() {
  const lookup = process.platform === "win32" ? "where" : "which";
  const located = spawnSync(lookup, ["tsc"], { encoding: "utf8" });
  if (located.status !== 0) return null;
  const first = located.stdout.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
  if (!first) return null;
  try {
    const executable = lstatSync(first).isSymbolicLink() ? realpathSync(first) : first;
    return require(join(dirname(dirname(executable)), "lib", "typescript.js"));
  } catch {
    return null;
  }
}

const ts = localTypeScript() ?? globalTypeScript();
if (!ts) {
  console.error("TypeScript compiler API is unavailable. Install repository dependencies or expose tsc on PATH.");
  process.exit(2);
}

const requested = process.argv.slice(2);
const files = (requested.length > 0
  ? requested.map((file) => resolve(root, file))
  : ["apps", "packages", "scripts", "tools"]
      .map((directory) => resolve(root, directory))
      .flatMap((directory) => walk(directory)))
  .sort();

const failures = [];
for (const absolute of files) {
  const source = readFileSync(absolute, "utf8");
  const scriptKind = absolute.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : absolute.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    absolute,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const diagnostics = (sourceFile.parseDiagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ({
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      start: diagnostic.start ?? null,
      length: diagnostic.length ?? null,
    }));
  if (diagnostics.length > 0) {
    failures.push({ file: relative(root, absolute).replaceAll("\\", "/"), diagnostics });
  }
}

console.log(JSON.stringify({
  compilerVersion: ts.version,
  checkedFiles: files.length,
  failureCount: failures.length,
  failures,
}, null, 2));
if (failures.length > 0) process.exitCode = 1;
