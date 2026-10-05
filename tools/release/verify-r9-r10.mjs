#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";

const required = [
	"packages/pipeline-runtime/src/service.mjs",
	"packages/pipeline-runtime/test/runtime.test.mjs",
	"packages/migration-runtime/src/coordinator.mjs",
	"packages/migration-runtime/test/runtime.test.mjs",
	"docs/implementation/MASTER_SCOPE.md",
	"DELIVERY_AUTONOMOUS_R9_R10.md",
];
for (const file of required) await access(file);
const pkg = JSON.parse(await readFile("package.json", "utf8"));
for (const name of [
	"test:pipeline-runtime",
	"test:migration-runtime",
	"test:r9-r10",
])
	if (!pkg.scripts?.[name]) throw new Error(`Missing ${name}`);
console.log(JSON.stringify({ ok: true, files: required.length }));
