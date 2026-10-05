import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const root = new URL("../../../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
test("both new routers enforce authenticated interactive sessions", async () => {
    for (const name of ["migrations", "operations"]) {
        const source = await read(`apps/api/src/${name}/${name}.router.ts`);
        assert.match(source, /@UseMiddlewares\(\s*AuthMiddleware\s*,\s*SessionOnlyMiddleware\s*\)/);
        const service = await read(`apps/api/src/${name}/${name}.service.ts`);
        assert.match(service, /requireDeploymentMembership/);
        assert.match(service, /workspaceId:\s*WORKSPACE_ID/);
        assert.match(service, /ctx\.user\.id\s*!==\s*ctx\.session\?\.user\.id/);
    }
});
test("mutation input contracts cannot select tenant, actor, raw CRM rows or role", async () => {
    for (const name of ["migrations", "operations"]) {
        const source = await read(`apps/api/src/${name}/${name}.contracts.ts`);
        const inputs = source.match(/export const \w+Input\s*=.*?(?=export const|$)/gs) ?? [];
        assert.ok(inputs.length >= 4);
        for (const input of inputs) {
            assert.match(input, /\.strict\(\)/);
            assert.doesNotMatch(input, /\b(?:tenantId|workspaceId|actorId|role|crmRows|permissionScopes)\s*:/);
        }
    }
});
test("operator API contains no public approval request or direct provider execute endpoint", async () => {
    const router = await read("apps/api/src/operations/operations.router.ts");
    assert.match(router, /decideApproval/);
    assert.doesNotMatch(router, /(?:createApproval|requestApproval|executeAction|restartRun)\s*\(/);
    const bridge = await read("apps/agent/agent/lib/governed-run-actions.ts");
    assert.match(bridge, /AGENT_APPROVAL_CENTER_ENABLED\s*===\s*["']1["']/);
    assert.match(bridge, /currentDeploymentPolicy\(request\)/);
});
test("new writes and approval storage are opt-in in the example environment", async () => {
    const source = await read(".env.example");
    for (const name of ["MIGRATION_CENTER_ENABLED", "MIGRATION_EXECUTION_ENABLED", "AGENT_APPROVAL_CENTER_ENABLED"])
        assert.match(source, new RegExp(`^${name}=0$`, "m"));
});
test("operator body bounds run before Nest initialization without globally consuming webhook bodies", async () => {
    const source = await read("apps/api/src/create-app.ts");
    assert.match(source, /bodyParser:\s*false/);
    assert.match(source, /app\.use\(["']\/api\/trpc["'],\s*createOperationsBodyGuard\(\)\)/);
    assert.ok(source.indexOf("createOperationsBodyGuard()") < source.indexOf("await app.init()"));
});
test("additive operations schema preserves legacy data and composite source isolation", async () => {
    const migration = await read("packages/db/prisma/migrations/20260914090000_migration_source_and_receipts/migration.sql");
    const approvals = await read("packages/db/prisma/migrations/20260914100000_bound_action_approvals/migration.sql");
    assert.match(migration, /FOREIGN KEY \("workspace_id", "source_id"\)/);
    assert.match(migration, /UNIQUE \("workspace_id", "job_id", "row_number"\)/);
    assert.match(approvals, /ALTER TABLE "GovernedActionApproval"/);
    assert.match(approvals, /"bindingVersion" IS NULL OR/);
    assert.match(approvals, /"runId"\) REFERENCES "agentRun"/);
    assert.doesNotMatch(migration + approvals, /\b(?:DROP|TRUNCATE|DELETE FROM)\b/i);
});
test("real operations DB acceptance is explicit and never replaced by local doubles", async () => {
    const gate = await read("tools/release/run-operations-postgres-gate.mjs");
    assert.match(gate, /resolveTestDatabase\(process\.env\)/);
    assert.doesNotMatch(gate, /TEST_DATABASE_URL\s*\?\?\s*process\.env\.DATABASE_URL/);
    const spec = await read("apps/api/test/operations-postgres.integration.spec.ts");
    assert.match(spec, /from "@crm\/db"/);
    assert.match(spec, /Promise\.all/);
    assert.match(spec, /db\.\$transaction/);
    assert.doesNotMatch(spec, /migrationPrismaDouble|createMemoryReceiptStore|test\.skip|it\.skip/);
});
