#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../../", import.meta.url));
const ignored = new Set(["node_modules", ".next", "dist", ".turbo", ".git", "coverage"]);
function walk(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        if (ignored.has(entry.name))
            return [];
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? walk(path) : entry.isFile() && path.endsWith(".test.mjs") ? [relative(root, path)] : [];
    });
}
const tests = process.argv.length > 2 ? process.argv.slice(2) : ["apps", "packages", "scripts", "tools"].flatMap(p => walk(resolve(root, p))).sort();
if (!tests.length)
    throw new Error("No tests discovered; refusing an empty green run");
const result = spawnSync(process.execPath, ["--import", "./tools/quality/register-workspaces.mjs", "--test", "--test-reporter=tap", "--test-concurrency=1", ...tests], { cwd: root, stdio: "inherit", timeout: 300000 });
if (result.error)
    console.error(result.error.message);
process.exitCode = result.status ?? 1;
