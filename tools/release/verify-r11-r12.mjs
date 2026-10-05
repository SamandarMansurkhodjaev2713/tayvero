#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";

const files = [
	"packages/integration-runtime/src/http-executor.mjs",
	"packages/integration-runtime/test/integration.test.mjs",
	"packages/action-registry/src/registry.mjs",
	"packages/action-registry/test/actions.test.mjs",
	"DELIVERY_AUTONOMOUS_R11_R12.md",
];
for (const f of files) await access(f);
const p = JSON.parse(await readFile("package.json", "utf8"));
for (const s of [
	"test:integration-runtime",
	"test:action-registry",
	"test:r11-r12",
])
	if (!p.scripts?.[s]) throw new Error(`Missing ${s}`);
console.log(JSON.stringify({ ok: true, files: files.length }));
