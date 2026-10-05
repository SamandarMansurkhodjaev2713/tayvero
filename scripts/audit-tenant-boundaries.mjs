import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(root, "docs", "security", "tenant-audit-baseline.json");
const reportPath = path.join(root, "docs", "quality", "generated-tenant-audit.json");
const writeBaseline = process.argv.includes("--write-baseline");
const check = process.argv.includes("--check") || !writeBaseline;
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const ignoredDirectories = new Set([
  ".git", ".next", ".turbo", "coverage", "dist", "build", "node_modules", "generated", "migrations",
]);

async function walk(directory, output = []) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute, output);
    else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) output.push(absolute);
  }
  return output;
}

async function prismaTenantModels() {
  const prismaFiles = [];
  async function findPrisma(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignoredDirectories.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await findPrisma(absolute);
      else if (entry.isFile() && entry.name.endsWith(".prisma")) prismaFiles.push(absolute);
    }
  }
  await findPrisma(root);
  const models = new Map();
  for (const file of prismaFiles) {
    const content = await readFile(file, "utf8");
    const modelPattern = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
    for (const match of content.matchAll(modelPattern)) {
      const [, name, body] = match;
      const tenantFieldMatch = body.match(/^\s*(workspaceId|organizationId|tenantId)\s+/m);
      if (tenantFieldMatch) models.set(name[0].toLowerCase() + name.slice(1), tenantFieldMatch[1]);
    }
  }
  return models;
}

function normalizeSnippet(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function fingerprint(finding) {
  return createHash("sha256")
    .update(JSON.stringify([finding.rule, finding.path, finding.snippet]), "utf8")
    .digest("hex");
}

const models = await prismaTenantModels();
const files = [
  ...(await walk(path.join(root, "apps"))),
  ...(await walk(path.join(root, "packages"))),
].filter((file) => !file.includes(`${path.sep}security-core${path.sep}`));

const findings = [];
const directMethods = "findMany|findFirst|findUnique|findUniqueOrThrow|update|updateMany|delete|deleteMany|upsert|count|aggregate|groupBy";
for (const file of files) {
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  const content = await readFile(file, "utf8");
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const hardcodedPatterns = [
      /\bWORKSPACE_ID\s*=\s*["']workspace["']/,
      /\bworkspaceId\s*:\s*["']workspace["']/,
      /\borganizationId\s*:\s*["']workspace["']/,
      /\btenantId\s*:\s*["']workspace["']/,
    ];
    if (hardcodedPatterns.some((pattern) => pattern.test(line))) {
      findings.push({
        rule: "hardcoded-tenant-identifier",
        path: relative,
        line: index + 1,
        snippet: normalizeSnippet(line),
        severity: "high",
      });
    }
    for (const [model, tenantField] of models) {
      const directPattern = new RegExp(`\\b${model}\\.(?:${directMethods})\\s*\\(`);
      if (!directPattern.test(line)) continue;
      const context = lines.slice(index, Math.min(lines.length, index + 12)).join(" ");
      const hasVisibleTenantScope = new RegExp(`\\b${tenantField}\\b|scopeTenant|tenantScoped`, "i").test(context);
      if (!hasVisibleTenantScope) {
        findings.push({
          rule: "potential-unscoped-tenant-model-operation",
          path: relative,
          line: index + 1,
          snippet: normalizeSnippet(line),
          severity: "review",
          model,
          tenantField,
        });
      }
    }
  }
}

for (const finding of findings) finding.fingerprint = fingerprint(finding);
findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.rule.localeCompare(b.rule));

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  tenantModels: Object.fromEntries([...models.entries()].sort()),
  counts: {
    sourceFilesScanned: files.length,
    tenantModels: models.size,
    findings: findings.length,
    high: findings.filter((finding) => finding.severity === "high").length,
    review: findings.filter((finding) => finding.severity === "review").length,
  },
  disclaimer: "This is a regression ratchet and review aid, not a proof of tenant isolation. Runtime and integration tests remain mandatory.",
  findings,
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

if (writeBaseline) {
  const baseline = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "security-r2-generated-baseline-requires-manual-review",
    disclaimer: report.disclaimer,
    fingerprints: findings.map((finding) => finding.fingerprint),
  };
  await writeFile(baselinePath, JSON.stringify(baseline, null, 2) + "\n", "utf8");
  process.stdout.write(`Tenant audit baseline written with ${findings.length} reviewed finding(s).\n`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(await readFile(baselinePath, "utf8"));
} catch {
  process.stderr.write("Tenant audit baseline is missing or invalid. Run with --write-baseline after review.\n");
  process.exit(1);
}
const known = new Set(Array.isArray(baseline.fingerprints) ? baseline.fingerprints : []);
const newFindings = findings.filter((finding) => !known.has(finding.fingerprint));
if (check && newFindings.length > 0) {
  process.stderr.write(`Tenant boundary audit found ${newFindings.length} new finding(s):\n`);
  for (const finding of newFindings.slice(0, 100)) {
    process.stderr.write(`- ${finding.path}:${finding.line} [${finding.rule}] ${finding.snippet}\n`);
  }
  process.exit(1);
}
process.stdout.write(`Tenant boundary ratchet passed. Current findings: ${findings.length}; new findings: 0.\n`);
