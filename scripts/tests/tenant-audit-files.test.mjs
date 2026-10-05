import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { walkTenantAuditSources } from "../lib/tenant-audit-files.mjs";

test("tenant audit omits only canonical generated Eve output and keeps similar source paths", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "tenant-audit-output-"));
	const sources = [
		"apps/agent/src/action.mjs",
		"apps/agent/src/.output/action.mjs",
		"apps/other/.output/action.mjs",
		"apps/agent/.output-source/action.mjs",
		"packages/.output/action.mjs",
	];
	const generated = "apps/agent/.output/server/index.mjs";
	try {
		for (const relative of [...sources, generated]) {
			const target = path.join(root, relative);
			await mkdir(path.dirname(target), { recursive: true });
			await writeFile(target, 'const query = { workspaceId: "workspace" };\n');
		}
		const files = await walkTenantAuditSources(root, {
			root,
			ignoredDirectories: new Set(),
			sourceExtensions: new Set([".mjs"]),
		});
		assert.deepEqual(
			files
				.map((file) => path.relative(root, file).replaceAll(path.sep, "/"))
				.sort(),
			sources.sort(),
		);
		for (const source of sources)
			assert.ok(files.includes(path.join(root, source)));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
