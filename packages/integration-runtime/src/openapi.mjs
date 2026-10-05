import { fail } from "./errors.mjs";

const METHODS = ["get", "post", "put", "patch", "delete"];
const plain = (value) =>
	value &&
	typeof value === "object" &&
	!Array.isArray(value) &&
	[Object.prototype, null].includes(Object.getPrototypeOf(value));
function snapshot(document) {
	const active = new Set();
	let nodes = 0;
	function visit(value, depth = 0) {
		if (++nodes > 50000 || depth > 48)
			fail(
				"INVALID_OPENAPI_STRUCTURE",
				"OpenAPI document exceeds complexity limits",
			);
		if (
			value === null ||
			typeof value === "string" ||
			typeof value === "boolean"
		) {
			if (typeof value === "string" && value.length > 100000)
				fail("INVALID_OPENAPI_STRUCTURE", "OpenAPI string is too long");
			return value;
		}
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if ((!plain(value) && !Array.isArray(value)) || active.has(value))
			fail("INVALID_OPENAPI_STRUCTURE", "Only acyclic plain JSON is supported");
		active.add(value);
		const output = Array.isArray(value) ? [] : {};
		for (const key of Object.keys(value)) {
			const property = Object.getOwnPropertyDescriptor(value, key);
			if (
				!property ||
				!("value" in property) ||
				["__proto__", "constructor", "prototype"].includes(key)
			)
				fail("INVALID_OPENAPI_STRUCTURE", "Unsafe OpenAPI object");
			if (
				key === "$ref" &&
				(typeof property.value !== "string" || !property.value.startsWith("#/"))
			)
				fail(
					"EXTERNAL_OPENAPI_REF",
					"Only local OpenAPI references are allowed",
				);
			output[key] = visit(property.value, depth + 1);
		}
		active.delete(value);
		return Object.freeze(output);
	}
	return visit(document);
}
export function compileOpenApiTools(input) {
	const document = snapshot(input);
	if (!plain(document) || !/^3\.[01]\.\d+$/.test(document.openapi ?? ""))
		fail("INVALID_OPENAPI", "OpenAPI 3.0/3.1 document is required");
	if (!plain(document.paths))
		fail("INVALID_OPENAPI_PATHS", "OpenAPI paths are required");
	const server = document.servers?.[0]?.url;
	let base;
	try {
		base = new URL(server);
	} catch {
		fail("OPENAPI_SERVER", "An explicit absolute server URL is required");
	}
	if (
		!["https:", "http:"].includes(base.protocol) ||
		base.username ||
		base.password ||
		base.search ||
		base.hash ||
		/[{}]/.test(server)
	)
		fail(
			"OPENAPI_SERVER",
			"Server URL must not contain credentials, query, fragment or unresolved variables",
		);
	const tools = [];
	const ids = new Set();
	for (const [path, item] of Object.entries(document.paths)) {
		let decoded;
		try {
			decoded = decodeURIComponent(path);
		} catch {
			fail("OPENAPI_PATH", "Invalid encoded path");
		}
		if (
			!path.startsWith("/") ||
			path.startsWith("//") ||
			// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject or sanitize control characters at this security boundary.
			/[\\?#\u0000-\u0020]/.test(decoded) ||
			decoded.startsWith("//") ||
			decoded.split("/").some((p) => p === "." || p === "..") ||
			/%/.test(decoded)
		)
			fail("OPENAPI_PATH", "Unsafe or ambiguous operation path");
		if (!plain(item)) fail("OPENAPI_PATH", "Path item must be an object");
		if (item.servers)
			fail(
				"OPENAPI_SERVER_OVERRIDE",
				"Per-path server overrides must be resolved explicitly before import",
			);
		for (const method of METHODS) {
			const op = item[method];
			if (!op) continue;
			if (!plain(op))
				fail("INVALID_OPENAPI_STRUCTURE", "Operation must be an object");
			if (op.servers)
				fail(
					"OPENAPI_SERVER_OVERRIDE",
					"Per-operation server overrides must be resolved explicitly before import",
				);
			const id = op.operationId;
			if (typeof id !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(id))
				fail(
					"OPENAPI_OPERATION_ID",
					"Every operation requires a safe operationId",
				);
			if (ids.has(id))
				fail("OPENAPI_DUPLICATE_OPERATION", "operationId must be unique");
			if (tools.length >= 256)
				fail(
					"OPENAPI_OPERATION_LIMIT",
					"Import at most 256 operations at once",
				);
			ids.add(id);
			// Append rather than URL-resolve: OpenAPI paths are relative to the server's base path.
			const urlTemplate = `${base.origin}${base.pathname.replace(/\/$/, "")}${path}`;
			tools.push(
				Object.freeze({
					id,
					method: method.toUpperCase(),
					urlTemplate,
					summary:
						typeof op.summary === "string" ? op.summary.slice(0, 1000) : null,
					inputSchema:
						op.requestBody?.content?.["application/json"]?.schema ??
						Object.freeze({ type: "object" }),
					risk:
						method === "get" ? "READ" : method === "delete" ? "HIGH" : "WRITE",
				}),
			);
		}
	}
	return Object.freeze(tools);
}
