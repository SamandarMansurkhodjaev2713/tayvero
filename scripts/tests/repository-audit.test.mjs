import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { auditRepository } from "../lib/repository-audit.mjs";

async function withRepository(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), "repository-audit-"));
  try { await callback(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("given clean repository when audited then returns no findings", async () => {
  await withRepository(async (root) => {
    await writeFile(path.join(root, "package.json"), '{"name":"clean"}\n', "utf8");
    assert.deepEqual(await auditRepository(root), []);
  });
});

test("given UTF-8 BOM package manifest when audited then reports JSON_BOM", async () => {
  await withRepository(async (root) => {
    await writeFile(path.join(root, "package.json"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"name":"bom"}\n')]));
    const findings = await auditRepository(root);
    assert.ok(findings.some((finding) => finding.code === "JSON_BOM"));
  });
});

test("given legacy identity in source when audited then reports it", async () => {
  await withRepository(async (root) => {
    await mkdir(path.join(root, "src"));
    const legacyDomain = ["try", "comp", ".ai"].join("");
    await writeFile(path.join(root, "src", "link.ts"), `export const url = "https://${legacyDomain}";\n`, "utf8");
    const findings = await auditRepository(root);
    assert.ok(findings.some((finding) => finding.code === "LEGACY_IDENTITY"));
  });
});

test("given secret-like token in source when audited then reports without exposing token", async () => {
  await withRepository(async (root) => {
    const token = `sk-${"A".repeat(30)}`;
    await writeFile(path.join(root, "config.ts"), `export const key = "${token}";\n`, "utf8");
    const findings = await auditRepository(root);
    assert.ok(findings.some((finding) => finding.code === "POTENTIAL_SECRET"));
    assert.ok(findings.every((finding) => !finding.message.includes(token)));
  });
});

test("given secret placeholder in .env.example when audited then does not treat it as committed secret", async () => {
  await withRepository(async (root) => {
    await writeFile(path.join(root, ".env.example"), "OPENAI_API_KEY=\n", "utf8");
    assert.deepEqual(await auditRepository(root), []);
  });
});
