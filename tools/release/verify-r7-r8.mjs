#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";

const required = [
	"packages/pipeline-core/src/index.mjs",
	"packages/pipeline-core/test/pipeline.test.mjs",
	"packages/migration-core/src/index.mjs",
	"packages/migration-core/test/migration.test.mjs",
	"docs/implementation/MASTER_SCOPE.md",
	"progress.md",
	"qa.md",
];
for (const path of required) await access(path);
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
for (const script of [
	"test:pipeline-core",
	"test:migration-core",
	"test:r7-r8",
]) {
	if (typeof packageJson.scripts?.[script] !== "string")
		throw new Error(`Missing script: ${script}`);
}
const schemaCandidates = [
	"packages/db/prisma/schema.prisma",
	"prisma/schema.prisma",
];
let schema = null;
for (const candidate of schemaCandidates) {
	try {
		schema = await readFile(candidate, "utf8");
		break;
	} catch {}
}
if (schema && !schema.includes("AUTONOMOUS-R7-R8"))
	throw new Error("Prisma R7/R8 marker is missing");
console.log(
	JSON.stringify({
		ok: true,
		requiredFiles: required.length,
		schemaUpdated: schema !== null,
	}),
);
