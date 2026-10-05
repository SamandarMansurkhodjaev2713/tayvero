import { fail } from "./errors.mjs";

const FORMULA_PREFIX = /^[\s\uFEFF]*[=+\-@]/u;
function assertDelimiter(value) {
	if (![",", ";", "\t", "|"].includes(value))
		fail("INVALID_DELIMITER", "Unsupported delimiter");
	return value;
}
function stripBom(value) {
	return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
function parseWithDelimiter(text, delimiter, limits, sample = false) {
	const rows = [],
		rowNumbers = [];
	let row = [],
		field = "",
		inQuotes = false,
		quoteClosed = false,
		index = 0,
		line = 1,
		rowLine = 1;
	function pushField() {
		if (field.length > limits.maxFieldCharacters)
			fail("FIELD_TOO_LARGE", "CSV field exceeds the configured limit");
		row.push(field);
		field = "";
		quoteClosed = false;
		if (row.length > limits.maxColumns)
			fail("TOO_MANY_COLUMNS", "CSV row exceeds the configured column limit");
	}
	function pushRow() {
		pushField();
		rows.push(Object.freeze(row));
		rowNumbers.push(rowLine);
		row = [];
		if (rows.length > limits.maxRows)
			fail("TOO_MANY_ROWS", "CSV exceeds the configured row limit");
	}
	while (index < text.length) {
		if (sample && (rows.length >= limits.maxRows || index >= 64000))
			return { rows, rowNumbers };
		const c = text[index];
		if (inQuotes) {
			if (c === '"') {
				if (text[index + 1] === '"') {
					field += '"';
					index += 2;
				} else {
					inQuotes = false;
					quoteClosed = true;
					index++;
				}
			} else if (c === "\r" && text[index + 1] === "\n") {
				field += "\r\n";
				line++;
				index += 2;
			} else {
				field += c;
				if (c === "\n" || c === "\r") line++;
				index++;
			}
		} else if (c === delimiter) {
			pushField();
			index++;
		} else if (c === "\n" || c === "\r") {
			pushRow();
			index += c === "\r" && text[index + 1] === "\n" ? 2 : 1;
			line++;
			rowLine = line;
		} else if (quoteClosed) {
			fail(
				"TRAILING_QUOTED_FIELD",
				"Only a delimiter or newline may follow a closing quote",
				{ line },
			);
		} else if (c === '"') {
			if (field.length)
				fail(
					"UNEXPECTED_QUOTE",
					"A quoted field must start at the beginning of a field",
					{ line },
				);
			inQuotes = true;
			index++;
		} else {
			field += c;
			index++;
		}
		if (field.length > limits.maxFieldCharacters)
			fail("FIELD_TOO_LARGE", "CSV field exceeds the configured limit");
	}
	if (inQuotes) {
		if (sample) return { rows, rowNumbers };
		fail("UNCLOSED_QUOTE", "CSV contains an unclosed quoted field");
	}
	if (field.length || row.length || quoteClosed) pushRow();
	return { rows, rowNumbers };
}
export function detectDelimiter(text) {
	if (typeof text !== "string")
		fail("INVALID_CSV", "CSV source must be a string");
	let best = null;
	for (const delimiter of [",", ";", "\t", "|"]) {
		try {
			const { rows } = parseWithDelimiter(
				stripBom(text),
				delimiter,
				{ maxRows: 30, maxColumns: 500, maxFieldCharacters: 100000 },
				true,
			);
			const counts = rows
				.filter((row) => row.some((value) => value !== ""))
				.map((row) => row.length);
			if (!counts.length) continue;
			const frequencies = new Map();
			for (const count of counts)
				frequencies.set(count, (frequencies.get(count) ?? 0) + 1);
			const [mode, consistent] = [...frequencies].sort(
				(a, b) => b[1] - a[1] || b[0] - a[0],
			)[0];
			const score = (mode > 1 ? 100000 : 0) + consistent * 1000 + mode;
			if (!best || score > best.score) best = { delimiter, score };
		} catch {
			/* Reject this candidate; the full parser reports the selected source error. */
		}
	}
	if (!best)
		fail(
			"DELIMITER_NOT_DETECTED",
			"Unable to detect a CSV delimiter; choose it explicitly",
		);
	return best.delimiter;
}
function limit(value, field, defaultValue, maximum) {
	const result = value ?? defaultValue;
	if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
		fail("INVALID_CSV_LIMIT", `${field} must be a bounded positive integer`);
	return result;
}
export function parseCsv(text, options = {}) {
	if (typeof text !== "string")
		fail("INVALID_CSV", "CSV source must be a string");
	const limits = {
		maxRows: limit(options.maxRows, "maxRows", 100001, 1000001),
		maxColumns: limit(options.maxColumns, "maxColumns", 500, 5000),
		maxFieldCharacters: limit(
			options.maxFieldCharacters,
			"maxFieldCharacters",
			1000000,
			10000000,
		),
	};
	const maxCharacters = limit(
		options.maxCharacters,
		"maxCharacters",
		50000000,
		50000000,
	);
	const source = stripBom(text);
	if (source.length > maxCharacters)
		fail("FILE_TOO_LARGE", "CSV source exceeds the configured character limit");
	if (!source.length)
		return Object.freeze({
			delimiter:
				options.delimiter && options.delimiter !== "auto"
					? assertDelimiter(options.delimiter)
					: ",",
			headers: Object.freeze([]),
			rows: Object.freeze([]),
			rowNumbers: Object.freeze([]),
		});
	const delimiter =
		options.delimiter === "auto" || options.delimiter == null
			? detectDelimiter(source)
			: assertDelimiter(options.delimiter);
	const parsed = parseWithDelimiter(source, delimiter, limits);
	const headers = (parsed.rows[0] ?? []).map((header) => header.trim());
	if (headers.some((header) => !header.length))
		fail("EMPTY_HEADER", "CSV headers cannot be empty");
	const normalized = headers.map((header) =>
		header.normalize("NFKC").toLocaleLowerCase("en-US"),
	);
	if (new Set(normalized).size !== normalized.length)
		fail("DUPLICATE_HEADER", "CSV headers must be unique after normalization");
	const rows = [],
		rowNumbers = [];
	for (let index = 1; index < parsed.rows.length; index++) {
		const row = parsed.rows[index];
		if (!row.some((value) => value !== "")) continue;
		if (row.length !== headers.length)
			fail(
				"COLUMN_COUNT_MISMATCH",
				"CSV row has a different number of columns than the header",
				{
					rowNumber: parsed.rowNumbers[index],
					expected: headers.length,
					actual: row.length,
				},
			);
		rows.push(row);
		rowNumbers.push(parsed.rowNumbers[index]);
	}
	return Object.freeze({
		delimiter,
		headers: Object.freeze(headers),
		rows: Object.freeze(rows),
		rowNumbers: Object.freeze(rowNumbers),
	});
}
export function neutralizeSpreadsheetFormula(value) {
	const text = value == null ? "" : String(value);
	return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

function encodeField(value, delimiter, neutralizeFormula) {
	let text = value == null ? "" : String(value);
	if (neutralizeFormula) text = neutralizeSpreadsheetFormula(text);
	if (text.includes('"')) text = text.replaceAll('"', '""');
	return text.includes(delimiter) ||
		text.includes("\n") ||
		text.includes("\r") ||
		text.includes('"')
		? `"${text}"`
		: text;
}

export function serializeCsv({
	headers,
	rows,
	delimiter = ",",
	neutralizeFormulas = true,
}) {
	assertDelimiter(delimiter);
	if (!Array.isArray(headers) || !Array.isArray(rows))
		fail("INVALID_CSV_OUTPUT", "headers and rows must be arrays");
	const lines = [
		headers
			.map((value) => encodeField(value, delimiter, neutralizeFormulas))
			.join(delimiter),
	];
	for (const row of rows) {
		if (!Array.isArray(row) || row.length !== headers.length)
			fail("INVALID_CSV_OUTPUT_ROW", "Output row must match the header width");
		lines.push(
			row
				.map((value) => encodeField(value, delimiter, neutralizeFormulas))
				.join(delimiter),
		);
	}
	return `${lines.join("\r\n")}\r\n`;
}
