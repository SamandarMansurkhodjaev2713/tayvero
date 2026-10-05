import { fail } from "./errors.mjs";

function type(value) {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	if (Number.isInteger(value)) return "integer";
	return typeof value;
}
export function validateSchema(schema, value, path = "$") {
	if (!schema || typeof schema !== "object")
		fail("INVALID_SCHEMA", "Action schema must be an object", { path });
	if (schema.enum && !schema.enum.some((item) => Object.is(item, value)))
		fail("SCHEMA_ENUM", "Value is outside enum", { path });
	if (schema.anyOf) {
		const errors = [];
		for (const branch of schema.anyOf) {
			try {
				return validateSchema(branch, value, path);
			} catch (e) {
				errors.push(e.code);
			}
		}
		fail("SCHEMA_ANY_OF", "Value matches no anyOf branch", { path, errors });
	}
	if (schema.type) {
		const actual = type(value);
		if (schema.type === "number" && ["number", "integer"].includes(actual)) {
		} else if (actual !== schema.type)
			fail("SCHEMA_TYPE", "Value type is invalid", {
				path,
				expected: schema.type,
				actual,
			});
	}
	if (typeof value === "string") {
		if (schema.minLength != null && value.length < schema.minLength)
			fail("SCHEMA_MIN_LENGTH", "String too short", { path });
		if (schema.maxLength != null && value.length > schema.maxLength)
			fail("SCHEMA_MAX_LENGTH", "String too long", { path });
		if (schema.pattern && !new RegExp(schema.pattern).test(value))
			fail("SCHEMA_PATTERN", "String pattern mismatch", { path });
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			fail("SCHEMA_NUMBER", "Number must be finite", { path });
		if (schema.minimum != null && value < schema.minimum)
			fail("SCHEMA_MINIMUM", "Number too small", { path });
		if (schema.maximum != null && value > schema.maximum)
			fail("SCHEMA_MAXIMUM", "Number too large", { path });
	}
	if (Array.isArray(value)) {
		if (schema.maxItems != null && value.length > schema.maxItems)
			fail("SCHEMA_MAX_ITEMS", "Array too large", { path });
		if (schema.minItems != null && value.length < schema.minItems)
			fail("SCHEMA_MIN_ITEMS", "Array too small", { path });
		for (let i = 0; i < value.length; i++)
			validateSchema(schema.items ?? {}, value[i], `${path}[${i}]`);
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		validateObjectSchema(schema, value, path);
	}
	return value;
}

function validateObjectSchema(schema, value, path) {
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null)
		fail("SCHEMA_OBJECT", "Only plain objects are accepted", { path });
	for (const required of schema.required ?? [])
		if (!Object.hasOwn(value, required))
			fail("SCHEMA_REQUIRED", "Required property is missing", {
				path,
				property: required,
			});
	const properties = schema.properties ?? {};
	for (const [key, item] of Object.entries(value)) {
		if (["__proto__", "prototype", "constructor"].includes(key))
			fail("SCHEMA_UNSAFE_KEY", "Unsafe object key", { path, key });
		if (!(key in properties)) {
			if (schema.additionalProperties === false)
				fail("SCHEMA_ADDITIONAL_PROPERTY", "Unexpected property", {
					path,
					key,
				});
			continue;
		}
		validateSchema(properties[key], item, `${path}.${key}`);
	}
}
