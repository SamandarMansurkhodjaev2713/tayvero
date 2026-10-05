import { readFile, writeFile } from "node:fs/promises";
import { generateAppearanceCss } from "../../packages/ui/src/theme/appearance.mjs";

const path = new URL(
	"../../packages/ui/src/styles/globals.css",
	import.meta.url,
);
const marker =
	"/* GENERATED APPEARANCE TOKENS — node tools/quality/generate-appearance.mjs */";
const css = await readFile(path, "utf8");
const output =
	css.split(marker)[0].trimEnd() +
	"\n\n" +
	marker +
	"\n" +
	generateAppearanceCss();
if (process.argv.includes("--check")) {
	if (css !== output) {
		console.error("Appearance CSS is stale; regenerate before release.");
		process.exitCode = 1;
	}
} else await writeFile(path, output);
