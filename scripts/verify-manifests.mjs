#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const skipped = new Set([
	".git",
	"node_modules",
	".next",
	"dist",
	"build",
	"coverage",
	".turbo",
]);
async function* walk(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && skipped.has(entry.name)) continue;
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) yield* walk(absolute);
		else if (entry.isFile() && entry.name === "package.json") yield absolute;
	}
}
let checked = 0;
for await (const manifest of walk(process.cwd())) {
	const raw = await readFile(manifest);
	if (raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
		throw new Error(`${manifest} contains UTF-8 BOM`);
	JSON.parse(raw.toString("utf8"));
	checked += 1;
}
console.log(`Verified ${checked} package.json manifest(s).`);
