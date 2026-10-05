import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
	appModule: "apps/api/src/app.module.ts",
	contracts: "apps/api/src/pipelines/pipelines.contracts.ts",
	core: "apps/api/src/pipelines/pipeline-api-core.mjs",
	router: "apps/api/src/pipelines/pipelines.router.ts",
	service: "apps/api/src/pipelines/pipelines.service.ts",
	middleware: "apps/api/src/trpc/middlewares/domain-error.middleware.ts",
	prismaAdapter: "packages/pipeline-runtime/src/prisma-adapter.mjs",
	generated: "apps/api/src/generated/server.ts",
	ui: "apps/app/app/(app)/[slug]/settings/pipelines/pipeline-settings.tsx",
	uiModel:
		"apps/app/app/(app)/[slug]/settings/pipelines/pipeline-editor-model.mjs",
};

async function source(name) {
	return readFile(files[name], "utf8");
}

test("pipeline router is registered and requires authenticated interactive sessions", async () => {
	const [moduleSource, router, service] = await Promise.all([
		source("appModule"),
		source("router"),
		source("service"),
	]);
	assert.match(moduleSource, /PipelinesModule/);
	assert.match(
		router,
		/@UseMiddlewares\(AuthMiddleware, SessionOnlyMiddleware\)/,
	);
	assert.match(router, /@Ctx\(\) ctx: AuthedTrpcContext/);
	assert.match(service, /activeOrganizationId/);
	assert.match(service, /organizationId_userId/);
	assert.doesNotMatch(service, /\bWORKSPACE_ID\b/);
});

test("pipeline mutations replay stable commands before reading mutable state", async () => {
	const [service, core] = await Promise.all([source("service"), source("core")]);
	assert.match(service, /createDeterministicPipelineIdFactory/);
	assert.match(service, /pipelineCreateCommandPayload/);
	assert.match(service, /pipelineUpdateCommandPayload/);
	assert.match(service, /this\.runtime\.replayCommand/);
	assert.match(service, /idempotencyPayload: commandPayload/);
	assert.doesNotMatch(service, /idFactory:\s*\(\)\s*=>\s*randomUUID\(\)/);
	assert.match(core, /crm-pipeline-id-v1/);
	assert.match(core, /createHash\("sha256"\)/);

	const createMethod = service.slice(
		service.indexOf("async create("),
		service.indexOf("async update("),
	);
	const createReplayIndex = createMethod.indexOf("replayCommand");
	const createReadIndex = createMethod.indexOf("listPipelines");
	assert.ok(createReplayIndex >= 0, "create must replay the command receipt");
	assert.ok(
		createReadIndex === -1 || createReplayIndex < createReadIndex,
		"create must replay the receipt before mutable-state reads",
	);
	const updateMethod = service.slice(
		service.indexOf("async update("),
		service.indexOf("async setDefault("),
	);
	assert.ok(
		updateMethod.indexOf("replayCommand") < updateMethod.indexOf("getPipeline"),
		"update must replay the receipt before loading the current version",
	);
});

test("public pipeline contracts are strict and expose no tenant selector", async () => {
	const contracts = await source("contracts");
	assert.doesNotMatch(contracts, /tenantId\s*:/);
	assert.doesNotMatch(contracts, /workspaceId\s*:/);
	assert.doesNotMatch(contracts, /organizationId\s*:/);
	assert.match(contracts, /idempotencyKey/);
	assert.match(contracts, /isDefault:\s*z\.boolean\(\)\.default\(false\)/);
	assert.match(contracts, /expectedVersion/);
	assert.match(contracts, /pipelineSetDefaultInput[\s\S]*expectedVersion/);
	const objectCount = (contracts.match(/z\s*\.object\(/g) ?? []).length;
	const strictCount = (contracts.match(/\.strict\(\)/g) ?? []).length;
	assert.ok(strictCount >= objectCount, "every public Zod object must be strict");
});

test("pipeline persistence uses bounded reads and serializable optimistic mutations", async () => {
	const adapter = await source("prismaAdapter");
	assert.match(adapter, /take:\s*MAX_PIPELINES_PER_WORKSPACE \+ 1/);
	assert.match(adapter, /isolationLevel:\s*"Serializable"/);
	assert.match(adapter, /P2034/);
	assert.match(adapter, /version:\s*expectedVersion/);
	assert.match(adapter, /RESERVED_STAGE_KEY_PREFIX/);
	assert.match(adapter, /STAGE_IN_USE/);
});

test("HTTP 412 remains a precondition failure at the tRPC error boundary", async () => {
	const middleware = await source("middleware");
	assert.match(middleware, /case HttpStatus\.PRECONDITION_FAILED/);
	assert.match(middleware, /return "PRECONDITION_FAILED"/);
});

test("generated client and accessible settings UI are connected without unsafe casts", async () => {
	const [generated, ui, uiModel] = await Promise.all([
		source("generated"),
		source("ui"),
		source("uiModel"),
	]);
	assert.match(generated, /pipelines: t\.router/);
	for (const operation of [
		"list",
		"create",
		"update",
		"setDefault",
		"archive",
		"restore",
	]) {
		assert.match(ui, new RegExp(`trpc\\.pipelines\\.${operation}`));
	}
	assert.match(ui, /AlertDialog/);
	assert.match(ui, /expectedVersion:\s*pipeline\.version/);
	assert.match(ui, /aria-live="polite"/);
	assert.doesNotMatch(ui, /\bas never\b/);
	assert.doesNotMatch(ui, /fake|mock pipeline/i);
	assert.match(uiModel, /toCreateMutationInput/);
	assert.match(uiModel, /isDefault:\s*draft\.isDefault/);
	assert.match(uiModel, /toUpdateMutationInput/);
	assert.doesNotMatch(uiModel, /tenantId|workspaceId|organizationId/);
});
