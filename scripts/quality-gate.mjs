#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { qualityPlan } from "./lib/quality-plan.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const scripts = qualityPlan(manifest, process.env);
const manager = manifest.packageManager?.startsWith("bun@") ? "bun" : "npm";
function execute(command, args) {
	console.log(`\n> ${command} ${args.join(" ")}`);
	const result = spawnSync(command, args, {
		cwd: root,
		stdio: "inherit",
		env: process.env,
		timeout: 1_800_000,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const script of [
	"tools/quality/run-local-tests.mjs",
	"scripts/verify-manifests.mjs",
	"tools/quality/verify-workspace-lock.mjs",
	"tools/quality/generate-appearance.mjs",
	"scripts/repository-audit.mjs",
]) {
	execute(process.execPath, [
		script,
		...(script.endsWith("generate-appearance.mjs") ? ["--check"] : []),
	]);
}
for (const script of scripts) execute(manager, ["run", script]);
