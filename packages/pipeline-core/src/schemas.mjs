export const PipelineDefinitionJsonSchema = Object.freeze({
	$id: "https://schemas.local/crm/pipeline-definition.json",
	type: "object",
	additionalProperties: false,
	required: [
		"id",
		"tenantId",
		"name",
		"slug",
		"isDefault",
		"isArchived",
		"version",
		"stages",
	],
	properties: {
		id: { type: "string", minLength: 1, maxLength: 128 },
		tenantId: { type: "string", minLength: 1, maxLength: 128 },
		name: { type: "string", minLength: 1, maxLength: 120 },
		slug: { type: "string", minLength: 1, maxLength: 64 },
		isDefault: { type: "boolean" },
		isArchived: { type: "boolean" },
		version: { type: "integer", minimum: 1 },
		stages: {
			type: "array",
			minItems: 3,
			maxItems: 200,
			items: {
				type: "object",
				additionalProperties: false,
				required: ["id", "key", "name", "position", "type", "probabilityBps"],
				properties: {
					id: { type: "string", minLength: 1, maxLength: 128 },
					key: { type: "string", pattern: "^[a-z][a-z0-9_]{0,62}$" },
					name: { type: "string", minLength: 1, maxLength: 120 },
					position: { type: "integer", minimum: 0 },
					type: { enum: ["OPEN", "WON", "LOST"] },
					probabilityBps: { type: "integer", minimum: 0, maximum: 10000 },
					color: {
						anyOf: [
							{ type: "null" },
							{ type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
						],
					},
					allowedFromStageIds: {
						type: "array",
						uniqueItems: true,
						items: { type: "string", minLength: 1, maxLength: 128 },
					},
				},
			},
		},
	},
});
