import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".txt",
  ".yml", ".yaml", ".toml", ".env", ".sql", ".prisma", ".css", ".scss",
  ".html", ".xml", ".sh", ".ps1",
]);

const SECRET_PATTERNS = [
  { name: "OpenAI API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { name: "Private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

const LEGACY_PATTERNS = [
  { name: "legacy first-party domain", pattern: /(?:trycomp\.ai|trycrm\.ai)/gi },
  { name: "legacy organization", pattern: /\btrycompai\b/gi },
  { name: "legacy product name", pattern: /\bComp AI\b/g },
  { name: "legacy author", pattern: /\bLewis Carhart\b/gi },
];

const ALLOWED_SECRET_FILES = new Set([".env.example", ".env.sample", ".env.template"]);

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(absolute);
    else if (entry.isFile()) yield absolute;
  }
}

function isTextFile(filePath) {
  const basename = path.basename(filePath);
  return basename.startsWith(".env") || TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase()) || ["Dockerfile", "Makefile", "Procfile"].includes(basename);
}

function redactLine(line) {
  if (line.length <= 180) return line;
  return `${line.slice(0, 177)}...`;
}

export async function auditRepository(rootDirectory) {
  const findings = [];
  for await (const filePath of walk(rootDirectory)) {
    const relativePath = path.relative(rootDirectory, filePath).replaceAll(path.sep, "/");
    const fileStats = await stat(filePath);
    if (fileStats.size > 5 * 1024 * 1024 || !isTextFile(filePath)) continue;
    const buffer = await readFile(filePath);
    if (path.basename(filePath) === "package.json" && buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
      findings.push({ severity: "error", code: "JSON_BOM", file: relativePath, line: 1, message: "package.json contains UTF-8 BOM" });
    }
    let content;
    try { content = buffer.toString("utf8"); } catch { continue; }
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const legacy of LEGACY_PATTERNS) {
        legacy.pattern.lastIndex = 0;
        if (legacy.pattern.test(line)) findings.push({ severity: "error", code: "LEGACY_IDENTITY", file: relativePath, line: index + 1, message: `${legacy.name}: ${redactLine(line.trim())}` });
      }
      if (!ALLOWED_SECRET_FILES.has(path.basename(filePath))) {
        for (const secret of SECRET_PATTERNS) {
          secret.pattern.lastIndex = 0;
          if (secret.pattern.test(line)) findings.push({ severity: "error", code: "POTENTIAL_SECRET", file: relativePath, line: index + 1, message: `${secret.name} detected; value redacted` });
        }
      }
    }
    if (path.basename(filePath) === "package.json") {
      try { JSON.parse(content.replace(/^\uFEFF/, "")); }
      catch (error) { findings.push({ severity: "error", code: "INVALID_JSON", file: relativePath, line: 1, message: String(error) }); }
    }
  }
  return findings;
}
