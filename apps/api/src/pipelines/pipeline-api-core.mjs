import { createHash } from "node:crypto";
import {
	PipelineDomainError,
	normalizePipelineSlug,
	parsePipelineDefinition,
} from "@crm/pipeline-core";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,200}$/;
const MANAGER_ROLES = new Set(["owner", "admin"]);
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const READ_PERMISSIONS = Object.freeze(["pipeline.read", "deal.transition"]);
const MANAGE_PERMISSIONS = Object.freeze([
	...READ_PERMISSIONS,
	"pipeline.create",
	"pipeline.update",
	"pipeline.set_default",
	"pipeline.archive",
	"pipeline.restore",
	"pipeline.migrate",
	"deal.reopen",
]);
const CREATE_FIELDS = new Set(["idempotencyKey", "name", "slug", "isDefault", "stages"]);
const UPDATE_FIELDS = new Set([
	"id",
	"idempotencyKey",
	"expectedVersion",
	"name",
	"slug",
	"stages",
]);
const CREATE_STAGE_FIELDS = new Set([
	"key",
	"name",
	"position",
	"type",
	"probabilityBps",
	"color",
	"allowedFromStageKeys",
]);
const UPDATE_STAGE_FIELDS = new Set([...CREATE_STAGE_FIELDS, "id"]);

export class PipelineApiCoreError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = "PipelineApiCoreError";
		this.code = code;
		this.details = Object.freeze({ ...details });
	}
}

function fail(code, message, details) {
	throw new PipelineApiCoreError(code, message, details);
}

function plainObject(value, path) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		fail("INVALID_INPUT", `${path} must be an object`, { path });
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		fail("INVALID_INPUT", `${path} must be a plain data object`, { path });
	}
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string") {
			fail("UNKNOWN_INPUT_FIELD", `${path} contains an unsupported property`, {
				path,
			});
		}
		if (FORBIDDEN_OBJECT_KEYS.has(key)) {
			fail("UNKNOWN_INPUT_FIELD", `${path}.${key} is not allowed`, {
				path: `${path}.${key}`,
			});
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || descriptor.get || descriptor.set) {
			fail("UNSAFE_INPUT_PROPERTY", `${path}.${key} must be a data property`, {
				path: `${path}.${key}`,
			});
		}
	}
	return value;
}

function assertExactFields(value, allowed, path) {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			fail("UNKNOWN_INPUT_FIELD", `${path}.${key} is not accepted`, {
				path: `${path}.${key}`,
			});
		}
	}
}

function ownValue(value, key) {
	return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function stableText(value) {
	return typeof value === "string" ? value.trim() : value;
}

function normalizeIdempotencyKey(value) {
	if (typeof value !== "string" || !IDEMPOTENCY_KEY.test(value)) {
		fail("INVALID_IDEMPOTENCY_KEY", "A stable idempotency key is required");
	}
	return value;
}

function normalizeCommandStage(raw, index, allowId) {
	const path = `stages[${index}]`;
	const stage = plainObject(raw, path);
	assertExactFields(stage, allowId ? UPDATE_STAGE_FIELDS : CREATE_STAGE_FIELDS, path);
	const allowedFromStageKeys = ownValue(stage, "allowedFromStageKeys") ?? [];
	if (!Array.isArray(allowedFromStageKeys)) {
		fail("INVALID_TRANSITION_SOURCES", `${path}.allowedFromStageKeys must be an array`, {
			path: `${path}.allowedFromStageKeys`,
		});
	}
	const normalized = {
		...(allowId && ownValue(stage, "id") !== undefined
			? { id: ownValue(stage, "id") }
			: {}),
		key:
			typeof ownValue(stage, "key") === "string"
				? ownValue(stage, "key").trim().toLowerCase()
				: ownValue(stage, "key"),
		name: stableText(ownValue(stage, "name")),
		position: ownValue(stage, "position"),
		type:
			typeof ownValue(stage, "type") === "string"
				? ownValue(stage, "type").trim().toUpperCase()
				: ownValue(stage, "type"),
		probabilityBps: ownValue(stage, "probabilityBps"),
		color:
			ownValue(stage, "color") === undefined ? null : ownValue(stage, "color"),
		allowedFromStageKeys: allowedFromStageKeys.map((sourceKey) =>
			typeof sourceKey === "string" ? sourceKey.trim().toLowerCase() : sourceKey,
		),
	};
	return Object.freeze({
		...normalized,
		allowedFromStageKeys: Object.freeze([...normalized.allowedFromStageKeys]),
	});
}

function commandPayload(input, allowedFields, allowStageIds, path) {
	const value = plainObject(input, path);
	assertExactFields(value, allowedFields, path);
	normalizeIdempotencyKey(ownValue(value, "idempotencyKey"));
	const rawStages = ownValue(value, "stages");
	if (!Array.isArray(rawStages)) {
		fail("INVALID_STAGES", "Pipeline stages must be an array");
	}
	const requestedDefault = ownValue(value, "isDefault");
	if (!allowStageIds && requestedDefault !== undefined && typeof requestedDefault !== "boolean") {
		fail("INVALID_DEFAULT_FLAG", "Pipeline default flag must be boolean");
	}
	const payload = {
		...(allowStageIds
			? {
					id: ownValue(value, "id"),
					expectedVersion: ownValue(value, "expectedVersion"),
				}
			: { isDefault: requestedDefault ?? false }),
		name: stableText(ownValue(value, "name")),
		...(ownValue(value, "slug") === undefined
			? {}
			: { slug: stableText(ownValue(value, "slug")) }),
		stages: Object.freeze(
			rawStages.map((stage, index) =>
				normalizeCommandStage(stage, index, allowStageIds),
			),
		),
	};
	return Object.freeze(payload);
}

export function pipelineCreateCommandPayload(input) {
	return commandPayload(input, CREATE_FIELDS, false, "pipeline");
}

export function pipelineUpdateCommandPayload(input) {
	return commandPayload(input, UPDATE_FIELDS, true, "pipeline");
}

export function createDeterministicPipelineIdFactory({
	tenantId,
	idempotencyKey,
	pipelineId = null,
}) {
	if (typeof tenantId !== "string" || !SAFE_ID.test(tenantId)) {
		fail("INVALID_TENANT_ID", "Tenant ID is invalid");
	}
	const key = normalizeIdempotencyKey(idempotencyKey);
	if (pipelineId !== null && (typeof pipelineId !== "string" || !SAFE_ID.test(pipelineId))) {
		fail("INVALID_PIPELINE_ID", "Pipeline ID is invalid");
	}
	return (kind) => {
		if (typeof kind !== "string" || kind.length < 1 || kind.length > 200) {
			fail("INVALID_ID_KIND", "Generated ID kind is invalid");
		}
		const digest = createHash("sha256")
			.update(JSON.stringify(["crm-pipeline-id-v1", tenantId, key, pipelineId, kind]))
			.digest("hex")
			.slice(0, 32);
		return `${kind === "pipeline" ? "pl" : "st"}_${digest}`;
	};
}

function generatedId(idFactory, kind) {
	if (typeof idFactory !== "function") {
		fail("INVALID_ID_FACTORY", "A server-owned ID factory is required");
	}
	const value = idFactory(kind);
	if (typeof value !== "string" || !SAFE_ID.test(value)) {
		fail("INVALID_GENERATED_ID", "ID factory returned an unsafe identifier", {
			kind,
		});
	}
	return value;
}

export function permissionsForWorkspaceRole(role) {
	if (MANAGER_ROLES.has(role)) return MANAGE_PERMISSIONS;
	if (role === "member") return READ_PERMISSIONS;
	fail("INVALID_WORKSPACE_ROLE", "Workspace membership has an unsupported role", {
		role,
	});
}

export function canManagePipelines(role) {
	return MANAGER_ROLES.has(role);
}

function normalizeDraftStages({ drafts, current, idFactory }) {
	if (!Array.isArray(drafts)) {
		fail("INVALID_STAGES", "Pipeline stages must be an array");
	}
	const currentStages = current?.stages ?? [];
	const currentById = new Map(currentStages.map((stage) => [stage.id, stage]));
	const currentByKey = new Map(currentStages.map((stage) => [stage.key, stage]));
	const usedIds = new Set();
	const normalized = drafts.map((draft, index) => {
		const key = typeof draft.key === "string" ? draft.key.trim().toLowerCase() : draft.key;
		let id;
		if (draft.id !== undefined) {
			if (!current) {
				fail(
					"CLIENT_STAGE_ID_FORBIDDEN",
					"Stage IDs are generated by the server during pipeline creation",
					{ index },
				);
			}
			if (typeof draft.id !== "string" || !SAFE_ID.test(draft.id)) {
				fail("INVALID_STAGE_ID", "Stage ID is invalid", { index });
			}
			if (!currentById.has(draft.id)) {
				fail(
					"UNKNOWN_STAGE_ID",
					"An updated stage ID does not belong to this pipeline",
					{ stageId: draft.id },
				);
			}
			id = draft.id;
		} else {
			const sameKey = currentByKey.get(key);
			id =
				sameKey && !usedIds.has(sameKey.id)
					? sameKey.id
					: generatedId(idFactory, `stage:${key || index}`);
		}
		if (usedIds.has(id)) {
			fail("DUPLICATE_STAGE_ID", "The same stage ID appears more than once", {
				stageId: id,
			});
		}
		usedIds.add(id);
		return {
			id,
			key,
			name: draft.name,
			position: draft.position,
			type: draft.type,
			probabilityBps: draft.probabilityBps,
			color: draft.color ?? null,
			allowedFromStageKeys: [...draft.allowedFromStageKeys],
		};
	});

	const idByKey = new Map();
	for (const stage of normalized) {
		if (idByKey.has(stage.key)) {
			fail("DUPLICATE_STAGE_KEY", "Stage keys must be unique", {
				stageKey: stage.key,
			});
		}
		idByKey.set(stage.key, stage.id);
	}

	return normalized.map(({ allowedFromStageKeys, ...stage }) => ({
		...stage,
		allowedFromStageIds: allowedFromStageKeys.map((sourceKey) => {
			const sourceId = idByKey.get(sourceKey);
			if (!sourceId) {
				fail(
					"UNKNOWN_TRANSITION_SOURCE",
					"Transition references a stage key that is not in this pipeline",
					{ stageKey: stage.key, sourceKey },
				);
			}
			return sourceId;
		}),
	}));
}

export function createPipelineDefinition({ tenantId, input, idFactory }) {
	const draft = pipelineCreateCommandPayload(input);
	const stages = normalizeDraftStages({
		drafts: draft.stages,
		current: null,
		idFactory,
	});
	return parsePipelineDefinition({
		id: generatedId(idFactory, "pipeline"),
		tenantId,
		name: draft.name,
		slug: normalizePipelineSlug(draft.slug || draft.name),
		// The runtime decides whether this is the first/default pipeline inside
		// the same serializable transaction that persists it.
		isDefault: draft.isDefault,
		isArchived: false,
		version: 1,
		stages,
	});
}

export function updatePipelineDefinition({ current, input, idFactory }) {
	const pipeline = parsePipelineDefinition(current);
	const draft = pipelineUpdateCommandPayload(input);
	if (draft.id !== pipeline.id) {
		fail("PIPELINE_ID_MISMATCH", "The request ID does not match the loaded pipeline", {
			requestId: draft.id,
			pipelineId: pipeline.id,
		});
	}
	if (draft.expectedVersion !== pipeline.version) {
		fail("STALE_PIPELINE", "Pipeline changed after the editor was opened", {
			expectedVersion: draft.expectedVersion,
			actualVersion: pipeline.version,
		});
	}
	const stages = normalizeDraftStages({
		drafts: draft.stages,
		current: pipeline,
		idFactory,
	});
	return parsePipelineDefinition({
		...pipeline,
		name: draft.name,
		slug: normalizePipelineSlug(draft.slug || draft.name),
		version: pipeline.version + 1,
		stages,
	});
}

export function toPipelineApiModel(pipelineInput, canManage) {
	const pipeline = parsePipelineDefinition(pipelineInput);
	const keyById = new Map(pipeline.stages.map((stage) => [stage.id, stage.key]));
	return Object.freeze({
		id: pipeline.id,
		name: pipeline.name,
		slug: pipeline.slug,
		isDefault: pipeline.isDefault,
		isArchived: pipeline.isArchived,
		version: pipeline.version,
		canManage,
		stages: Object.freeze(
			pipeline.stages.map((stage) =>
				Object.freeze({
					...stage,
					allowedFromStageIds: Object.freeze([...stage.allowedFromStageIds]),
					allowedFromStageKeys: Object.freeze(
						stage.allowedFromStageIds.map((stageId) => {
							const key = keyById.get(stageId);
							if (!key) {
								fail(
									"CORRUPT_TRANSITION",
									"Stored transition points to an unknown stage",
									{ stageId },
								);
							}
							return key;
						}),
					),
				}),
			),
		),
	});
}

export function isPipelineInputError(error) {
	return error instanceof PipelineApiCoreError || error instanceof PipelineDomainError;
}
