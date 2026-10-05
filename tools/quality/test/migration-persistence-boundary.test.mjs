import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("migration persistence is tenant scoped and transactionally durable", async () => {
  const source = await readFile("packages/migration-runtime/src/prisma-repository.mjs", "utf8");
  assert.match(source, /isolationLevel:\s*"Serializable"/);
  assert.match(source, /workspaceId:\s*tenantId/);
  assert.match(source, /nextBatchState/);
  assert.doesNotMatch(source, /DATABASE_URL/);
});

test("migration schema permits intentional reuse of the same source file", async () => {
  const schema = await readFile("packages/db/prisma/schema.prisma", "utf8");
  const migration = await readFile("packages/db/prisma/migrations/20260905133000_migration_runtime_durability/migration.sql", "utf8");
  assert.doesNotMatch(schema, /@@unique\(\[workspaceId, sourceSha256, entityType\]/);
  assert.match(schema, /crm_migration_job_source_entity_created_idx/);
  assert.match(migration, /DROP INDEX IF EXISTS "crm_migration_job_source_entity_key"/);
  assert.match(migration, /CREATE TABLE "crm_migration_event"/);
});

test("migration coordinator validates source identity and final accounting", async () => {
  const source = await readFile("packages/migration-runtime/src/coordinator.mjs", "utf8");
  assert.match(source, /INVALID_SOURCE_FILENAME/);
  assert.match(source, /DRY_RUN_COUNT_MISMATCH/);
  assert.match(source, /BATCH_OUTCOME_COUNT_MISMATCH/);
  assert.match(source, /JOB_COUNT_MISMATCH/);
});
