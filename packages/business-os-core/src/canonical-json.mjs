function assertJsonValue(value, stack) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON rejects non-finite numbers");
    return;
  }
  if (typeof value !== "object") throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
  if (stack.has(value)) throw new TypeError("Canonical JSON rejects cyclic values");
  stack.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item === undefined) throw new TypeError("Canonical JSON rejects undefined array items");
      assertJsonValue(item, stack);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Canonical JSON accepts plain objects only");
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) throw new TypeError(`Canonical JSON rejects undefined object property: ${key}`);
      assertJsonValue(item, stack);
    }
  }
  stack.delete(value);
}

function serialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${serialize(value[key])}`).join(",")}}`;
}

export function canonicalJson(value) {
  assertJsonValue(value, new WeakSet());
  return serialize(value);
}
