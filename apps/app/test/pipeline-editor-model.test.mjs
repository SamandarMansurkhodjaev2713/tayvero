import assert from "node:assert/strict";
import test from "node:test";
import {
	addStage,
	moveStage,
	newPipelineDraft,
	removeStage,
	toCreateMutationInput,
	toggleTransition,
	toMutationInput,
	toUpdateMutationInput,
	updateStage,
	validatePipelineDraft,
} from "../app/(app)/[slug]/settings/pipelines/pipeline-editor-model.mjs";

test("default draft is complete and valid", () => {
	const draft = newPipelineDraft();
	assert.deepEqual(validatePipelineDraft(draft), []);
	assert.deepEqual(
		draft.stages.map((stage) => stage.type),
		["OPEN", "OPEN", "WON", "LOST"],
	);
});

test("renaming a stage key updates transition references", () => {
	const draft = updateStage(newPipelineDraft(), 0, { key: "incoming" });
	assert.equal(draft.stages[0].key, "incoming");
	assert.ok(draft.stages[1].allowedFromStageKeys.includes("incoming"));
	assert.equal(draft.stages[1].allowedFromStageKeys.includes("new"), false);
});

test("terminal and open stage probabilities remain deterministic", () => {
	let draft = updateStage(newPipelineDraft(), 0, {
		type: "WON",
		probabilityBps: 2_300,
	});
	assert.equal(draft.stages[0].probabilityBps, 10_000);
	draft = updateStage(draft, 0, { type: "LOST", probabilityBps: 9_900 });
	assert.equal(draft.stages[0].probabilityBps, 0);
	draft = updateStage(draft, 0, { type: "OPEN", probabilityBps: 50_000 });
	assert.equal(draft.stages[0].probabilityBps, 9_999);
});

test("reordering and removal keep contiguous positions and remove dangling transitions", () => {
	let draft = addStage(newPipelineDraft());
	const removedKey = draft.stages[1].key;
	draft = toggleTransition(draft, 4, removedKey, true);
	draft = moveStage(draft, 4, 1);
	draft = removeStage(draft, 2);
	assert.deepEqual(
		draft.stages.map((stage) => stage.position),
		[0, 1, 2, 3],
	);
	assert.equal(
		draft.stages.some((stage) =>
			stage.allowedFromStageKeys.includes(removedKey),
		),
		false,
	);
});

test("create mutation excludes server-owned identity and preserves default intent", () => {
	const draft = { ...newPipelineDraft(), isDefault: true };
	const input = toCreateMutationInput(draft, "pipeline-create:12345678");
	assert.equal("tenantId" in input, false);
	assert.equal("workspaceId" in input, false);
	assert.equal(input.isDefault, true);
	assert.equal(
		input.stages.some((stage) => "id" in stage),
		false,
	);
});

test("update mutation preserves optimistic version and existing stage identity", () => {
	const draft = {
		...newPipelineDraft(),
		id: "pipeline-1",
		version: 7,
		stages: newPipelineDraft().stages.map((stage, index) => ({
			...stage,
			id: `stage-${index}`,
		})),
	};
	const input = toUpdateMutationInput(draft, "pipeline-update:12345678");
	assert.equal(input.expectedVersion, 7);
	assert.equal(input.stages[0].id, "stage-0");
	assert.equal("tenantId" in input, false);
	assert.equal("workspaceId" in input, false);
	assert.deepEqual(toMutationInput(draft, "pipeline-update:12345678"), input);
});

test("validation rejects malformed probabilities, colors, positions and transitions", () => {
	const source = newPipelineDraft();
	const invalid = {
		...source,
		stages: source.stages.map((stage) => ({ ...stage })),
	};
	invalid.stages[0].probabilityBps = Number.NaN;
	invalid.stages[1].position = 9;
	invalid.stages[2].color = "red";
	invalid.stages[3].allowedFromStageKeys = ["missing", "missing"];
	const errors = validatePipelineDraft(invalid);
	assert.ok(errors.some((message) => message.includes("probability")));
	assert.ok(errors.some((message) => message.includes("positions")));
	assert.ok(errors.some((message) => message.includes("color")));
	assert.ok(errors.some((message) => message.includes("unknown previous")));
	assert.ok(errors.some((message) => message.includes("duplicate transition")));
});

test("mutation conversion refuses invalid drafts and idempotency keys", () => {
	const invalid = { ...newPipelineDraft(), name: "" };
	assert.throws(
		() => toCreateMutationInput(invalid, "pipeline-create:12345678"),
		/Enter a pipeline name/,
	);
	assert.throws(
		() => toCreateMutationInput(newPipelineDraft(), "short"),
		/idempotency key/,
	);
});
