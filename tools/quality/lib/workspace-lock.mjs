import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
/** Parse the checked-in JSONC lock without evaluating JavaScript. */
export function parseJsonc(source) {
	let clean = "",
		quoted = false,
		escaped = false;
	for (let i = 0; i < source.length; i += 1) {
		const char = source[i],
			next = source[i + 1];
		if (quoted) {
			clean += char;
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') quoted = false;
		} else if (char === '"') {
			quoted = true;
			clean += char;
		} else if (char === "/" && next === "/") {
			while (i < source.length && source[i] !== "\n") i += 1;
			clean += "\n";
		} else if (char === "/" && next === "*") {
			i += 2;
			while (i < source.length && !(source[i] === "*" && source[i + 1] === "/"))
				i += 1;
			if (i === source.length) throw new Error("Unclosed JSONC comment");
			i += 1;
			clean += " ";
		} else clean += char;
	}
	let normalized = "";
	quoted = false;
	escaped = false;
	for (let i = 0; i < clean.length; i += 1) {
		const char = clean[i];
		if (quoted) {
			normalized += char;
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') quoted = false;
		} else if (char === '"') {
			quoted = true;
			normalized += char;
		} else if (char === "," && /^[\s]*[}\]]/.test(clean.slice(i + 1))) continue;
		else normalized += char;
	}
	return JSON.parse(normalized);
}
function canonical(value) {
	return JSON.stringify(
		Object.fromEntries(
			Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)),
		),
	);
}
export function workspaceLockFindings(root, lock) {
	const paths = [
		"package.json",
		...["apps", "packages"].flatMap((dir) =>
			readdirSync(join(root, dir), { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => `${dir}/${entry.name}/package.json`)
				.filter((file) => existsSync(join(root, file))),
		),
	];
	const findings = [];
	for (const file of paths) {
		const pkg = JSON.parse(readFileSync(join(root, file), "utf8"));
		const key =
			file === "package.json" ? "" : file.replace(/\/package.json$/, "");
		const locked = lock.workspaces?.[key];
		if (!locked) {
			findings.push({ file, code: "WORKSPACE_MISSING" });
			continue;
		}
		if (locked.name !== pkg.name || (key && locked.version !== pkg.version))
			findings.push({ file, code: "WORKSPACE_IDENTITY" });
		for (const field of [
			"dependencies",
			"devDependencies",
			"peerDependencies",
			"optionalDependencies",
		]) {
			if (canonical(pkg[field]) !== canonical(locked[field]))
				findings.push({ file, code: "WORKSPACE_DEPENDENCIES", field });
		}
		if (
			key &&
			lock.packages?.[pkg.name]?.[0] !== `${pkg.name}@workspace:${key}`
		)
			findings.push({ file, code: "WORKSPACE_RESOLUTION" });
	}
	return findings;
}
