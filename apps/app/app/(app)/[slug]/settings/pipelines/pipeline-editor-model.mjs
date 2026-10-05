const STAGE_KEY = /^[a-z][a-z0-9_]{0,62}$/;
const RESERVED_STAGE_KEY_PREFIX = "zz_internal_";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,200}$/;
const MAX_PIPELINE_STAGES = 200;
const MAX_PIPELINE_NAME = 120;
const MAX_PIPELINE_SLUG = 64;
const COLORS = Object.freeze([
	"#64748B",
	"#2563EB",
	"#7C3AED",
	"#16A34A",
	"#DC2626",
]);

function normalizeStageKey(value) {
	return String(value ?? "")
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/_{2,}/g, "_")
		.slice(0, 63);
}

function normalizePipelineSlug(value, truncate = true) {
	const normalized = String(value ?? "")
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");
	return truncate ? normalized.slice(0, MAX_PIPELINE_SLUG) : normalized;
}

function normalizedProbability(type, value, fallback) {
	if (type === "WON") return 10_000;
	if (type === "LOST") return 0;
	const candidate = Number.isFinite(value) ? Math.round(value) : fallback;
	return Math.min(9_999, Math.max(0, candidate));
}

function stage(key, name, type, probabilityBps, position, allowedFromStageKeys) {
	return {
		id: null,
		key,
		name,
		position,
		type,
		probabilityBps,
		color: COLORS[Math.min(position, COLORS.length - 1)],
		allowedFromStageKeys,
	};
}

export function newPipelineDraft() {
	return {
		id: null,
		name: "Sales",
		slug: "sales",
		isDefault: false,
		isArchived: false,
		version: 0,
		stages: [
			stage("new", "New", "OPEN", 1_000, 0, []),
			stage("qualified", "Qualified", "OPEN", 6_000, 1, ["new"]),
			stage("won", "Won", "WON", 10_000, 2, ["qualified"]),
			stage("lost", "Lost", "LOST", 0, 3, ["new", "qualified"]),
		],
	};
}

export function draftFromPipeline(pipeline) {
	return {
		id: pipeline.id,
		name: pipeline.name,
		slug: pipeline.slug,
		isDefault: pipeline.isDefault,
		isArchived: pipeline.isArchived,
		version: pipeline.version,
		stages: pipeline.stages.map((item) => ({
			id: item.id,
			key: item.key,
			name: item.name,
			position: item.position,
			type: item.type,
			probabilityBps: item.probabilityBps,
			color: item.color,
			allowedFromStageKeys: [...item.allowedFromStageKeys],
		})),
	};
}

export function addStage(draft) {
	if (draft.stages.length >= MAX_PIPELINE_STAGES) return draft;
	const used = new Set(draft.stages.map((item) => item.key));
	let suffix = draft.stages.length + 1;
	let key = `stage_${suffix}`;
	while (used.has(key) && suffix <= MAX_PIPELINE_STAGES * 2) {
		suffix += 1;
		key = `stage_${suffix}`;
	}
	if (used.has(key)) return draft;
	return {
		...draft,
		stages: [
			...draft.stages,
			stage(
				key,
				`Stage ${suffix}`,
				"OPEN",
				5_000,
				draft.stages.length,
				draft.stages.map((item) => item.key),
			),
		],
	};
}

export function removeStage(draft, index) {
	if (draft.stages.length <= 3) return draft;
	const removed = draft.stages[index];
	if (!removed) return draft;
	return {
		...draft,
		stages: draft.stages
			.filter((_, itemIndex) => itemIndex !== index)
			.map((item, position) => ({
				...item,
				position,
				allowedFromStageKeys: item.allowedFromStageKeys.filter(
					(key) => key !== removed.key,
				),
			})),
	};
}

export function moveStage(draft, from, to) {
	if (
		!Number.isSafeInteger(from) ||
		!Number.isSafeInteger(to) ||
		from < 0 ||
		to < 0 ||
		from >= draft.stages.length ||
		to >= draft.stages.length ||
		from === to
	) {
		return draft;
	}
	const stages = [...draft.stages];
	const [item] = stages.splice(from, 1);
	if (!item) return draft;
	stages.splice(to, 0, item);
	return {
		...draft,
		stages: stages.map((itemStage, position) => ({
			...itemStage,
			position,
		})),
	};
}

export function updateStage(draft, index, patch) {
	const current = draft.stages[index];
	if (!current) return draft;
	const nextType = patch.type ?? current.type;
	const previousKey = current.key;
	const nextKey =
		patch.key === undefined ? previousKey : normalizeStageKey(patch.key);
	const next = {
		...current,
		...patch,
		key: nextKey,
		name: patch.name === undefined ? current.name : String(patch.name),
		color:
			patch.color === undefined
				? current.color
				: patch.color === null
					? null
					: String(patch.color).toUpperCase(),
		probabilityBps: normalizedProbability(
			nextType,
			patch.probabilityBps,
			current.probabilityBps,
		),
	};
	return {
		...draft,
		stages: draft.stages.map((item, itemIndex) => {
			if (itemIndex === index) return next;
			return previousKey === nextKey
				? item
				: {
						...item,
						allowedFromStageKeys: item.allowedFromStageKeys.map((key) =>
							key === previousKey ? nextKey : key,
						),
					};
		}),
	};
}

export function toggleTransition(draft, targetIndex, sourceKey, checked) {
	const target = draft.stages[targetIndex];
	if (
		!target ||
		target.key === sourceKey ||
		!draft.stages.some((item) => item.key === sourceKey)
	) {
		return draft;
	}
	const values = new Set(target.allowedFromStageKeys);
	if (checked) values.add(sourceKey);
	else values.delete(sourceKey);
	return updateStage(draft, targetIndex, {
		allowedFromStageKeys: [...values],
	});
}

function addError(errors, message) {
	if (!errors.includes(message) && errors.length < 50) errors.push(message);
}

export function validatePipelineDraft(draft) {
	const errors = [];
	if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
		return ["Pipeline draft is invalid."];
	}
	const name = typeof draft.name === "string" ? draft.name.trim() : "";
	if (!name) addError(errors, "Enter a pipeline name.");
	if (name.length > MAX_PIPELINE_NAME) {
		addError(errors, `Pipeline name cannot exceed ${MAX_PIPELINE_NAME} characters.`);
	}
	const rawSlugSource =
		typeof draft.slug === "string" && draft.slug.trim()
			? draft.slug.trim()
			: name;
	const normalizedSlug = normalizePipelineSlug(rawSlugSource, false);
	if (!normalizedSlug) {
		addError(errors, "Enter a slug that contains Latin letters or digits.");
	}
	if (rawSlugSource.length > MAX_PIPELINE_SLUG || normalizedSlug.length > MAX_PIPELINE_SLUG) {
		addError(errors, `Pipeline slug cannot exceed ${MAX_PIPELINE_SLUG} characters.`);
	}
	if (!Array.isArray(draft.stages)) {
		return [...errors, "Pipeline stages are invalid."];
	}
	if (draft.stages.length < 3) {
		addError(errors, "A pipeline needs at least three stages.");
	}
	if (draft.stages.length > MAX_PIPELINE_STAGES) {
		addError(errors, `A pipeline cannot exceed ${MAX_PIPELINE_STAGES} stages.`);
	}
	if (draft.id === null) {
		if (draft.version !== 0) addError(errors, "A new pipeline has an invalid version.");
	} else {
		if (typeof draft.id !== "string" || !SAFE_ID.test(draft.id)) {
			addError(errors, "Pipeline ID is invalid.");
		}
		if (!Number.isSafeInteger(draft.version) || draft.version < 1) {
			addError(errors, "Pipeline version is invalid.");
		}
	}
	if (draft.isArchived && draft.isDefault) {
		addError(errors, "An archived pipeline cannot be the default pipeline.");
	}

	const keys = new Set();
	const ids = new Set();
	const knownKeys = new Set(
		draft.stages
			.map((item) => (typeof item?.key === "string" ? item.key : ""))
			.filter(Boolean),
	);
	for (const [index, item] of draft.stages.entries()) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			addError(errors, `Stage ${index + 1} is invalid.`);
			continue;
		}
		const stageName = typeof item.name === "string" ? item.name.trim() : "";
		if (!stageName) addError(errors, `Stage ${index + 1} needs a name.`);
		if (stageName.length > 120) {
			addError(errors, `Stage ${index + 1} name is too long.`);
		}
		if (
			typeof item.key !== "string" ||
			!STAGE_KEY.test(item.key) ||
			item.key.startsWith(RESERVED_STAGE_KEY_PREFIX)
		) {
			addError(errors, `Stage key “${String(item.key)}” is invalid.`);
		}
		if (keys.has(item.key)) {
			addError(errors, `Stage key “${item.key}” is duplicated.`);
		}
		keys.add(item.key);
		if (item.id !== null) {
			if (typeof item.id !== "string" || !SAFE_ID.test(item.id)) {
				addError(errors, `Stage ${index + 1} has an invalid ID.`);
			}
			if (ids.has(item.id)) addError(errors, "Stage IDs must be unique.");
			ids.add(item.id);
		}
		if (item.position !== index || !Number.isSafeInteger(item.position)) {
			addError(errors, "Stage positions must be contiguous and zero-based.");
		}
		if (!["OPEN", "WON", "LOST"].includes(item.type)) {
			addError(errors, `Stage ${index + 1} has an invalid outcome.`);
		}
		if (
			!Number.isSafeInteger(item.probabilityBps) ||
			item.probabilityBps < 0 ||
			item.probabilityBps > 10_000
		) {
			addError(errors, `Stage ${index + 1} probability is invalid.`);
		}
		if (item.type === "WON" && item.probabilityBps !== 10_000) {
			addError(errors, "Won stages must have 100% probability.");
		}
		if (item.type === "LOST" && item.probabilityBps !== 0) {
			addError(errors, "Lost stages must have 0% probability.");
		}
		if (item.type === "OPEN" && item.probabilityBps === 10_000) {
			addError(errors, "Open stages must have less than 100% probability.");
		}
		if (item.color !== null && !HEX_COLOR.test(item.color)) {
			addError(errors, `Stage ${index + 1} color is invalid.`);
		}
		if (!Array.isArray(item.allowedFromStageKeys)) {
			addError(errors, `Stage ${index + 1} transition rules are invalid.`);
			continue;
		}
		if (item.allowedFromStageKeys.length > MAX_PIPELINE_STAGES - 1) {
			addError(errors, `Stage ${index + 1} has too many transition rules.`);
		}
		const sources = new Set();
		for (const sourceKey of item.allowedFromStageKeys) {
			if (typeof sourceKey !== "string" || !STAGE_KEY.test(sourceKey)) {
				addError(errors, `Stage ${index + 1} has an invalid transition key.`);
				continue;
			}
			if (sources.has(sourceKey)) {
				addError(errors, `Stage ${index + 1} has a duplicate transition rule.`);
			}
			sources.add(sourceKey);
			if (sourceKey === item.key) {
				addError(errors, `Stage ${index + 1} cannot transition from itself.`);
			}
			if (!knownKeys.has(sourceKey)) {
				addError(errors, `Stage ${index + 1} references an unknown previous stage.`);
			}
		}
	}
	if (!draft.stages.some((item) => item?.type === "OPEN")) {
		addError(errors, "Add at least one open stage.");
	}
	if (!draft.stages.some((item) => item?.type === "WON")) {
		addError(errors, "Add a won stage.");
	}
	if (!draft.stages.some((item) => item?.type === "LOST")) {
		addError(errors, "Add a lost stage.");
	}
	return errors;
}

function assertMutationInput(draft, key) {
	if (typeof key !== "string" || !IDEMPOTENCY_KEY.test(key)) {
		throw new Error("A valid idempotency key is required.");
	}
	const errors = validatePipelineDraft(draft);
	if (errors.length > 0) throw new Error(errors[0]);
}

function stagesForMutation(draft, includeIds) {
	return draft.stages.map((item, position) => ({
		...(includeIds && item.id ? { id: item.id } : {}),
		key: item.key,
		name: item.name.trim(),
		position,
		type: item.type,
		probabilityBps: item.probabilityBps,
		color: item.color || null,
		allowedFromStageKeys: [...item.allowedFromStageKeys],
	}));
}

export function toCreateMutationInput(draft, key) {
	assertMutationInput(draft, key);
	if (draft.id !== null) throw new Error("Existing pipelines must be updated.");
	return {
		idempotencyKey: key,
		name: draft.name.trim(),
		slug: normalizePipelineSlug(draft.slug || draft.name),
		isDefault: draft.isDefault,
		stages: stagesForMutation(draft, false),
	};
}

export function toUpdateMutationInput(draft, key) {
	assertMutationInput(draft, key);
	if (draft.id === null || draft.version < 1) {
		throw new Error("New pipelines must be created before they can be updated.");
	}
	if (draft.isArchived) {
		throw new Error("Restore an archived pipeline before editing it.");
	}
	return {
		id: draft.id,
		idempotencyKey: key,
		expectedVersion: draft.version,
		name: draft.name.trim(),
		slug: normalizePipelineSlug(draft.slug || draft.name),
		stages: stagesForMutation(draft, true),
	};
}

export function toMutationInput(draft, key) {
	return draft.id === null
		? toCreateMutationInput(draft, key)
		: toUpdateMutationInput(draft, key);
}
