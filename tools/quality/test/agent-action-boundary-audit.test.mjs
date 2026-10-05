import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { auditAgentActionBoundaries } from "../lib/agent-action-boundary-audit.mjs";

async function withRepository(files, callback) {
  const root = await mkdtemp(path.join(tmpdir(), "agent-action-audit-"));
  try {
    for (const [name, source] of Object.entries(files)) {
      const file = path.join(root, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, source, "utf8");
    }
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("accepts the single governed executor boundary", async () => {
  await withRepository({
    "packages/agent-action-runtime/src/index.mjs": "manifest.executor({ input });\n",
    "apps/agent/src/service.mjs": "governed.execute(request);\n",
  }, async (root) => {
    assert.deepEqual(await auditAgentActionBoundaries(root), []);
  });
});

test("reports direct catalog execution in production source", async () => {
  await withRepository({
    "apps/agent/src/unsafe.mjs": 'import { createActionRegistry } from "@crm/action-registry";\nconst registry=createActionRegistry();\nregistry.execute({});\n',
  }, async (root) => {
    const findings = await auditAgentActionBoundaries(root);
    assert.equal(findings.some((item) => item.code === "DIRECT_ACTION_REGISTRY_EXECUTION" && item.severity === "error"), true);
  });
});

test("reports the removed parallel execution API", async () => {
  await withRepository({
    "apps/agent/src/unsafe.mjs": 'import { InMemoryActionState } from "@crm/action-registry";\nnew InMemoryActionState();\n',
  }, async (root) => {
    const findings = await auditAgentActionBoundaries(root);
    assert.equal(findings.some((item) => item.code === "LEGACY_ACTION_REGISTRY_EXECUTION_API"), true);
  });
});

test("reports direct executor calls outside the governed runtime", async () => {
  await withRepository({
    "packages/other/src/unsafe.mjs": "await manifest.executor({});\n",
  }, async (root) => {
    const findings = await auditAgentActionBoundaries(root);
    assert.equal(findings.some((item) => item.code === "DIRECT_ACTION_EXECUTOR_CALL"), true);
  });
});

test("reports direct executor calls reached through a catalog lookup", async () => {
  await withRepository({
    "apps/agent/src/unsafe.mjs": 'await catalog.get("crm.deal.update").executor({});\n',
  }, async (root) => {
    const findings = await auditAgentActionBoundaries(root);
    assert.equal(findings.some((item) => item.code === "DIRECT_ACTION_EXECUTOR_CALL"), true);
  });
});

test("excludes test and fixture paths from production findings", async () => {
  await withRepository({
    "packages/action-registry/test/actions.test.mjs": "registry.execute({});\nmanifest.executor({});\n",
    "apps/agent/fixtures/legacy.ts": "AGENT_ACTION_EXECUTORS.run();\n",
  }, async (root) => {
    assert.deepEqual(await auditAgentActionBoundaries(root), []);
  });
});

test("classifies the existing legacy dispatch as migration work instead of a hidden success", async () => {
  await withRepository({
    "apps/agent/agent/lib/run-runtime.ts": "const executor = AGENT_ACTION_EXECUTORS[type];\n",
  }, async (root) => {
    const findings = await auditAgentActionBoundaries(root);
    assert.deepEqual(findings.map(({ code, severity }) => ({ code, severity })), [
      { code: "LEGACY_AGENT_ACTION_DISPATCH", severity: "migration" },
    ]);
  });
});


test("accepts low-level run side effects only inside the governed bridge", async () => {
  await withRepository({
    "apps/agent/agent/lib/run-runtime.ts": "export async function executeRunActivitySideEffect() {}\n",
    "apps/agent/agent/lib/governed-run-actions.ts": "await executeRunActivitySideEffect();\nawait executeRunSlackMessageSideEffect();\n",
  }, async (root) => {
    assert.deepEqual(await auditAgentActionBoundaries(root), []);
  });
});

test("reports direct run side-effect calls outside the governed bridge", async () => {
  await withRepository({
    "apps/agent/agent/tools/unsafe.ts": "await executeRunActivitySideEffect();\n",
  }, async (root) => {
    const findings = await auditAgentActionBoundaries(root);
    assert.equal(
      findings.some(
        (item) => item.code === "DIRECT_RUN_ACTION_SIDE_EFFECT" && item.severity === "error",
      ),
      true,
    );
  });
});

test("reports removed direct run-action entrypoints as migration work", async () => {
  await withRepository({
    "apps/agent/agent/tools/legacy.ts": "await createRunActivity(runId, callId, input);\n",
  }, async (root) => {
    const findings = await auditAgentActionBoundaries(root);
    assert.equal(
      findings.some(
        (item) => item.code === "LEGACY_RUN_ACTION_ENTRYPOINT" && item.severity === "migration",
      ),
      true,
    );
  });
});
