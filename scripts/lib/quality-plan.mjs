/** Full release gate: missing scripts must not turn semantic type checks green. */
export function qualityPlan(manifest, env = {}) {
    if (env.QUALITY_SKIP_BUILD === "1")
        throw new Error("Full quality gate cannot skip build. Use test:local for the dependency-free lane.");
    const required = ["format:check", "lint", "check-types", "test", "build"];
    for (const name of required) {
        if (typeof manifest.scripts?.[name] !== "string" || !manifest.scripts[name].trim())
            throw new Error(`Required quality script is missing: ${name}`);
    }
    return required;
}
