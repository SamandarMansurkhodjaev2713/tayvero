import { readdir } from "node:fs/promises";
import path from "node:path";

export function isGeneratedAgentBuildOutput(directory, root) {
	return (
		path.resolve(directory) === path.resolve(root, "apps", "agent", ".output")
	);
}

export async function walkTenantAuditSources(directory, options, output = []) {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch {
		return output;
	}
	for (const entry of entries) {
		if (options.ignoredDirectories.has(entry.name)) continue;
		const absolute = path.join(directory, entry.name);
		// Eve's compiled server duplicates source findings with generated locations.
		// Exclude only its canonical output; similarly named source paths still scan.
		if (isGeneratedAgentBuildOutput(absolute, options.root)) continue;
		if (entry.isDirectory())
			await walkTenantAuditSources(absolute, options, output);
		else if (
			entry.isFile() &&
			options.sourceExtensions.has(path.extname(entry.name))
		)
			output.push(absolute);
	}
	return output;
}
