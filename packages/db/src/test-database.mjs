/** Fail-closed database selection for destructive integration-test tooling.
 * A suffix is not proof of isolation: also reject the configured live identity.
 * DNS aliases cannot be proven equivalent here; remote use is explicit opt-in.
 */
const SAFE_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,57}_test$/;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PARAMS = new Set(["sslmode", "connect_timeout", "connection_limit", "pool_timeout", "schema"]);
function invalid(message) {
    throw new Error(message);
}
function parse(value, label) {
    if (typeof value !== "string" || !value.trim() || value.length > 8192)
        invalid(`${label} must be an explicit PostgreSQL URL.`);
    let url;
    let database;
    try {
        url = new URL(value);
        database = decodeURIComponent(url.pathname.slice(1));
    }
    catch {
        invalid(`${label} is not a valid PostgreSQL URL.`);
    }
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.hash || !database || database.includes("/")) {
        invalid(`${label} must identify exactly one PostgreSQL database.`);
    }
    return { url, database };
}
function identity({ url, database }) {
    const host = LOOPBACK.has(url.hostname.toLowerCase()) ? "loopback" : url.hostname.toLowerCase().replace(/\.$/, "");
    return JSON.stringify([host, url.port || "5432", database]);
}
export function resolveTestDatabase(env = process.env) {
    if (!env.TEST_DATABASE_URL)
        invalid("TEST_DATABASE_URL is required explicitly; never fall back to DATABASE_URL.");
    const target = parse(env.TEST_DATABASE_URL, "TEST_DATABASE_URL");
    if (!SAFE_NAME.test(target.database))
        invalid("TEST_DATABASE_URL must use a safe identifier ending in _test (maximum 63 characters).");
    const seen = new Set();
    for (const [key, value] of target.url.searchParams) {
        if (!PARAMS.has(key) || seen.has(key))
            invalid("TEST_DATABASE_URL has an unsupported or repeated connection parameter.");
        seen.add(key);
        if (key === "sslmode" && !["disable", "prefer", "require", "verify-ca", "verify-full"].includes(value))
            invalid("Invalid test sslmode.");
        if (key === "schema" && value !== "public")
            invalid("The integration harness supports only the public test schema.");
        if (!["sslmode", "schema"].includes(key) && (!/^\d{1,3}$/.test(value) || Number(value) < 1 || Number(value) > 100))
            invalid("Invalid bounded test connection parameter.");
    }
    if (env.DATABASE_URL) {
        const live = parse(env.DATABASE_URL, "DATABASE_URL");
        if (identity(target) === identity(live))
            invalid("TEST_DATABASE_URL must not target the configured DATABASE_URL database, even with different credentials or query parameters.");
    }
    const remote = !LOOPBACK.has(target.url.hostname.toLowerCase());
    if (remote && env.ALLOW_REMOTE_TEST_DATABASE !== "1")
        invalid("Remote integration databases require ALLOW_REMOTE_TEST_DATABASE=1 and an isolated test server.");
    return Object.freeze({ url: target.url.toString(), database: target.database, remote });
}
export function assertTestDatabaseResetAllowed(env = process.env) {
    if (env.ALLOW_TEST_DATABASE_RESET !== "1")
        invalid("--reset also requires ALLOW_TEST_DATABASE_RESET=1; no database was dropped.");
}
