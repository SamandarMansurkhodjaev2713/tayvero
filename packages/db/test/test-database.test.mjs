import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assertTestDatabaseResetAllowed, resolveTestDatabase } from "../src/test-database.mjs";
const local = "postgresql://test:secret@127.0.0.1:5432/tayvero_test";
const resolve = (TEST_DATABASE_URL, extra = {}) => resolveTestDatabase({ TEST_DATABASE_URL, ...extra });
test("test DB never derives a target from DATABASE_URL", () => {
    assert.throws(() => resolve(undefined, { DATABASE_URL: "postgresql://prod:secret@db/customer" }), /required explicitly/);
});
test("explicit disposable loopback target is accepted without leaking configuration", () => {
    assert.equal(resolve(local).database, "tayvero_test");
    assert.equal(resolve(local).remote, false);
    assert.equal(resolve("postgres://test@localhost/tayvero_test").database, "tayvero_test");
});
test("same DB is rejected despite changed credentials, scheme, port default and query", () => {
    assert.throws(() => resolve("postgres://different@localhost/tayvero_test?sslmode=require", { DATABASE_URL: local }), /must not target/);
    assert.throws(() => resolve(local, { DATABASE_URL: "postgres://x@127.0.0.1/tayvero_test?connection_limit=2" }), /must not target/);
});
test("remote targets require opt-in and still reject normalized live identity", () => {
    assert.throws(() => resolve("postgres://test@database.example/app_test"), /ALLOW_REMOTE/);
    assert.equal(resolve("postgres://test@database.example/app_test", { ALLOW_REMOTE_TEST_DATABASE: "1" }).remote, true);
    assert.throws(() => resolve("postgres://test@database.example./app_test", { ALLOW_REMOTE_TEST_DATABASE: "1", DATABASE_URL: "postgresql://other@database.example:5432/app_test?sslmode=require" }), /must not target/);
});
test("unsafe database identifiers and ambiguous paths fail closed", () => {
    for (const name of ["app", 'a%22_test', 'a%2Fb_test', 'a%00_test', "_test", "a".repeat(59) + "_test", "app-test", "app_test/"]) {
        assert.throws(() => resolve(`postgres://user@localhost/${name}`));
    }
    assert.equal(resolve(`postgres://user@localhost/${"a".repeat(58)}_test`).database.length, 63);
});
test("connection redirection, schema changes and repeated params are rejected", () => {
    for (const query of ["host=production", "dbname=production", "user=admin", "sslcert=/tmp/private", "options=-c", "schema=production", "sslmode=require&sslmode=disable", "connect_timeout=999", "pool_timeout=-1"]) {
        assert.throws(() => resolve(`${local}?${query}`));
    }
    assert.equal(resolve(`${local}?sslmode=require&schema=public&connect_timeout=5`).database, "tayvero_test");
});
test("invalid URLs do not echo credentials in errors", () => {
    for (const value of ["secret-token", "https://secret-token@localhost/app_test", `${local}#secret-token`]) {
        assert.throws(() => resolve(value), error => !error.message.includes("secret-token"));
    }
    assert.throws(() => resolve(local, { DATABASE_URL: "not-a-real-url-secret" }), /DATABASE_URL is not a valid/);
});
test("reset needs separate explicit consent", () => {
    assert.throws(() => assertTestDatabaseResetAllowed({}), /ALLOW_TEST_DATABASE_RESET/);
    assert.doesNotThrow(() => assertTestDatabaseResetAllowed({ ALLOW_TEST_DATABASE_RESET: "1" }));
});
test("test DB implementation has no implicit live fallback, auto-reset or credential printing", () => {
    const source = readFileSync(new URL("../scripts/test-db.ts", import.meta.url), "utf8");
    assert.match(source, /resolveTestDatabase\(process.env\)/);
    assert.match(source, /assertTestDatabaseResetAllowed/);
    assert.doesNotMatch(source, /const live = process\.env\.DATABASE_URL|TEST_DATABASE_URL="\$\{url\}"/);
    assert.match(source, /if \(!forced\)/);
    assert.match(source, /Never rebuild automatically/);
});
