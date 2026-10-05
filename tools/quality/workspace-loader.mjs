// Resolve only the repository's declared workspaces; never install or execute packages.
// Allows the dependency-free test lane to run from a clean release ZIP.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");
const workspaces = new Map();
for (const parent of ["apps", "packages"]) {
    for (const entry of readdirSync(resolvePath(root, parent), { withFileTypes: true })) {
        if (!entry.isDirectory())
            continue;
        const directory = resolvePath(root, parent, entry.name);
        try {
            const manifest = JSON.parse(readFileSync(resolvePath(directory, "package.json"), "utf8"));
            workspaces.set(manifest.name, { directory, manifest });
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
    }
}
export async function resolve(specifier, context, nextResolve) {
    const parts = specifier.split("/");
    const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    const workspace = workspaces.get(name);
    if (!workspace)
        return nextResolve(specifier, context);
    const subpath = specifier === name ? "." : `.${specifier.slice(name.length)}`;
    const exports = workspace.manifest.exports;
    const entry = typeof exports === "string" && subpath === "." ? exports : exports?.[subpath];
    function select(value) {
        if (typeof value === "string")
            return value;
        if (!value || typeof value !== "object" || Array.isArray(value))
            return undefined;
        for (const [condition, next] of Object.entries(value)) {
            if (condition === "default" || context.conditions.includes(condition)) {
                const chosen = select(next);
                if (chosen)
                    return chosen;
            }
        }
    }
    const target = select(entry);
    if (typeof target !== "string" || !target.startsWith("./")) {
        throw new Error(`Unsupported local test workspace export: ${specifier}`);
    }
    const path = resolvePath(workspace.directory, target);
    if (!path.startsWith(workspace.directory + sep))
        throw new Error("Workspace export escapes its package");
    return { url: pathToFileURL(path).href, shortCircuit: true };
}
