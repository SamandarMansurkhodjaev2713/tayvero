
import { fail } from "./errors.mjs";
import { normalizeCompanyName, normalizeEmail, normalizeUzbekistanPhone, parseMoneyMinor } from "./normalize.mjs";

const TRANSFORMERS = Object.freeze({
  string(value) {
    return String(value ?? "").trim();
  },
  email(value) {
    return normalizeEmail(value);
  },
  phone_uz(value) {
    return normalizeUzbekistanPhone(value);
  },
  money_minor(value, field) {
    return parseMoneyMinor(value, field.scale ?? 2);
  },
  boolean(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (["true", "1", "yes", "y", "да"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "нет"].includes(normalized)) return false;
    fail("INVALID_BOOLEAN", "Value cannot be parsed as a boolean", { value });
  },
  date(value) {
    const text = String(value ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail("INVALID_DATE", "Date must use YYYY-MM-DD format", { value });
    const parsed = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) fail("INVALID_DATE", "Date is not a real calendar date", { value });
    return text;
  },
  company_name(value) {
    return normalizeCompanyName(value);
  },
});

const RESERVED_TARGETS = new Set(["__proto__", "constructor", "prototype", "tenantId", "workspaceId", "organizationId", "sourceRowNumber"]);

function plainData(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code, "Only plain data objects are accepted");
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, "value")) fail(code, "Accessor properties are not accepted");
  }
  if (Object.getOwnPropertySymbols(value).length) fail(code, "Symbol properties are not accepted");
  return value;
}

export function compileMapping({ headers, mapping, targetSchema }) {
  if (!Array.isArray(headers) || !headers.length || headers.length > 200 || headers.some(value => typeof value !== "string" || !value.trim() || value.length > 1000) || new Set(headers.map(value => value.trim().toLowerCase())).size !== headers.length) fail("INVALID_HEADERS", "Headers must be bounded, non-empty and unambiguous");
  if (!Array.isArray(mapping) || mapping.length > 200) fail("INVALID_MAPPING", "Mapping must contain at most 200 entries");
  plainData(targetSchema, "INVALID_TARGET_SCHEMA");
  if (Object.keys(targetSchema).length > 200) fail("INVALID_TARGET_SCHEMA", "At most 200 target fields are supported");
  const schema = Object.create(null);
  for (const [target, value] of Object.entries(targetSchema)) {
    if (RESERVED_TARGETS.has(target) || !target.trim() || target.length > 128) fail("INVALID_TARGET_FIELD", "Unsafe or reserved target field", { target });
    const field = plainData(value, "INVALID_TARGET_FIELD");
    if (typeof field.type !== "string" || !Object.hasOwn(TRANSFORMERS, field.type)) fail("INVALID_TARGET_FIELD", "Unsupported transformer", { target });
    if (field.required !== undefined && typeof field.required !== "boolean") fail("INVALID_TARGET_FIELD", "required must be a boolean", { target });
    if (field.scale !== undefined && (!Number.isInteger(field.scale) || field.scale < 0 || field.scale > 6)) fail("INVALID_TARGET_FIELD", "Invalid money scale", { target });
    const snapshot = { type: field.type, required: field.required === true };
    if (field.scale !== undefined) snapshot.scale = field.scale;
    if (field.default !== undefined) {
      const value = field.default;
      // Defaults are already-normalized domain values, not input text to transform again.
      const valid = value === null ? !snapshot.required
        : field.type === "boolean" ? typeof value === "boolean"
        : field.type === "money_minor" ? typeof value === "string" && /^-?(0|[1-9]\d*)$/.test(value) && value.length <= 100
        : typeof value === "string" && value.length <= 100000 && (!snapshot.required || value.trim() !== "");
      if (!valid) fail("INVALID_DEFAULT", "Default must be a valid scalar domain value", { target });
      if (value !== null && !["boolean", "money_minor", "string"].includes(field.type) && TRANSFORMERS[field.type](value, snapshot) !== value) fail("INVALID_DEFAULT", "Default must already be normalized", { target });
      snapshot.default = value;
    }
    schema[target] = Object.freeze(snapshot);
  }
  const headerIndexes = new Map(headers.map((header, index) => [header, index]));
  const targetNames = new Set();
  const compiled = mapping.map((entry, index) => {
    plainData(entry, "INVALID_MAPPING_ENTRY");
    const { source, target } = entry;
    if (typeof source !== "string" || !headerIndexes.has(source)) fail("UNKNOWN_SOURCE_COLUMN", "Unknown source column", { index, source });
    if (typeof target !== "string" || !Object.hasOwn(schema, target)) fail("UNKNOWN_TARGET_FIELD", "Unknown target field", { index, target });
    if (targetNames.has(target)) fail("DUPLICATE_TARGET_MAPPING", "A target field cannot be mapped twice", { target });
    targetNames.add(target);
    return Object.freeze({ source, sourceIndex: headerIndexes.get(source), target, field: schema[target] });
  });
  for (const [target, field] of Object.entries(schema)) {
    if (field.required && !targetNames.has(target) && field.default === undefined) fail("MISSING_REQUIRED_MAPPING", "Required field has no source mapping", { target });
  }
  return Object.freeze({ headers: Object.freeze([...headers]), targetSchema: Object.freeze(schema), entries: Object.freeze(compiled) });
}

export function mapRow(row, compiled) {
  if (!Array.isArray(row) || row.length !== compiled.headers.length) fail("ROW_WIDTH", "Row width differs from the compiled mapping header");
  if (row.some(value => value !== null && value !== undefined && !["string", "number", "boolean"].includes(typeof value))) fail("INVALID_CELL", "Import cells must be scalar values");
  const output = Object.create(null);
  for (const [target, field] of Object.entries(compiled.targetSchema)) {
    if (field.default !== undefined) output[target] = field.default;
  }
  for (const entry of compiled.entries) {
    const raw = row[entry.sourceIndex];
    if ((raw === "" || raw == null) && entry.field.required !== true) {
      output[entry.target] = null;
      continue;
    }
    if ((raw === "" || raw == null) && entry.field.required === true) fail("REQUIRED_VALUE", "Required field is empty", { target: entry.target });
    output[entry.target] = TRANSFORMERS[entry.field.type](raw, entry.field);
  }
  for (const [target, field] of Object.entries(compiled.targetSchema)) {
    if (field.required === true && (output[target] === null || output[target] === undefined || output[target] === "")) fail("REQUIRED_VALUE", "Required target field is empty", { target });
  }
  return Object.freeze(output);
}
