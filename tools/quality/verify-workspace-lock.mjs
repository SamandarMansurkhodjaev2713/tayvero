#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonc, workspaceLockFindings } from "./lib/workspace-lock.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const findings = workspaceLockFindings(
	root,
	parseJsonc(readFileSync(join(root, "bun.lock"), "utf8")),
);
console.log(
	JSON.stringify(
		{
			scope:
				"Workspace metadata only; not a Bun frozen install or registry integrity check",
			findings,
		},
		null,
		2,
	),
);
if (findings.length) process.exitCode = 1;
