import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../../../", import.meta.url));
async function fixture(t) {
    const dir = await mkdtemp(path.join(tmpdir(), "crm-source-cli-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const env = { ...process.env, MIGRATION_SOURCE_ROOT: path.join(dir, "sources"), MIGRATION_SOURCE_KEY_HEX: randomBytes(32).toString("hex"), MIGRATION_TENANT_ID: "workspace-test", MIGRATION_ACTOR_ID: "operator-test" };
    const run = (...args) => spawnSync(process.execPath, ["--import", "./tools/quality/register-workspaces.mjs", "tools/migrations/prepare-source.mjs", ...args], { cwd: root, env, encoding: "utf8", timeout: 10000 });
    return { dir, env, run };
}
test("operator upload and a new-process plan recover the same encrypted source", async (t) => {
    const f = await fixture(t), file = path.join(f.dir, "customers.csv"), preview = path.join(f.dir, "preview.json"), plan = path.join(f.dir, "plan.json"), definition = path.join(f.dir, "mapping.json");
    await writeFile(file, "Email\na@example.test\nb@example.test\n");
    const upload = f.run("upload", "--file", file, "--out", preview);
    assert.equal(upload.status, 0, upload.stderr);
    assert.ok(!upload.stdout.includes("a@example.test"));
    const source = JSON.parse(await readFile(preview, "utf8")).source;
    await writeFile(definition, JSON.stringify({ entityType: "contact", mapping: [{ source: "Email", target: "email" }], targetSchema: { email: { type: "email", required: true } } }));
    const result = f.run("plan", "--source", source.id, "--sha256", source.sha256, "--definition", definition, "--out", plan);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(plan, "utf8"));
    assert.equal(report.crmWrites, false);
    assert.equal(report.plan.stats.validRows, 2);
    assert.equal(report.status, "PREPARATION_ONLY");
    assert.equal((await stat(plan)).mode & 0o777, 0o600);
});
test("operator preparation fails without keys and never overwrites a report", async (t) => {
    const f = await fixture(t), file = path.join(f.dir, "x.csv"), out = path.join(f.dir, "report.json");
    await writeFile(file, "Email\na@example.test\n");
    await writeFile(out, "retain-me");
    const blocked = f.run("upload", "--file", file, "--out", out);
    assert.equal(blocked.status, 1);
    assert.equal(await readFile(out, "utf8"), "retain-me");
    f.env.MIGRATION_SOURCE_KEY_HEX = "";
    const noKey = f.run("upload", "--file", file, "--out", path.join(f.dir, "new.json"));
    assert.equal(noKey.status, 1);
});
test("unsupported files fail before any CRM write or success report", async (t) => {
    const f = await fixture(t), file = path.join(f.dir, 'file.xlsx'), out = path.join(f.dir, 'report.json');
    await writeFile(file, Buffer.from([0x50, 0x4b, 3, 4]));
    const result = f.run('upload', '--file', file, '--out', out);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(await readFile(out, 'utf8'), '');
});
