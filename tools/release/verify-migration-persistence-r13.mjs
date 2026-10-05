import { access, readFile } from "node:fs/promises";

const required = [
  "packages/migration-runtime/src/batch-invariants.mjs",
  "packages/migration-runtime/src/coordinator.mjs",
  "packages/migration-runtime/src/prisma-repository.mjs",
  "packages/migration-runtime/test/prisma-repository.test.mjs",
  "packages/db/prisma/migrations/20260905133000_migration_runtime_durability/migration.sql",
  "tools/quality/test/migration-persistence-boundary.test.mjs",
  "docs/adr/0012-durable-migration-runtime.md",
  "DELIVERY_MIGRATION_PERSIST_002.md",
];
for (const path of required) await access(path);
const scope = await readFile("docs/implementation/MASTER_SCOPE.md", "utf8");
if (!scope.includes("MIG-PERSIST-002")) throw new Error("Master scope is missing MIG-PERSIST-002");
const schema = await readFile("packages/db/prisma/schema.prisma", "utf8");
if (schema.includes('@@unique([workspaceId, sourceSha256, entityType]')) throw new Error("Unsafe source-hash uniqueness remains");
console.log(JSON.stringify({ ok: true, requiredFiles: required.length, parallelScopeId: "MIG-PERSIST-002", nextScopeId: "CRM-PIPE-POSTGRES-005", migrationNextScopeId: "MIG-API-002" }));
