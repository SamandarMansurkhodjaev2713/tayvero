import { domainToASCII } from "node:url";

export function normalizeEmail(value) {
	if (value == null || String(value).trim() === "") return null;
	const text = String(value).trim().toLowerCase();
	const at = text.lastIndexOf("@");
	if (at <= 0 || at === text.length - 1)
		throw new TypeError("email is invalid");
	const local = text.slice(0, at);
	const domain = domainToASCII(text.slice(at + 1));
	if (!domain || local.length > 64 || `${local}@${domain}`.length > 254)
		throw new TypeError("email is invalid");
	return `${local}@${domain}`;
}

export function normalizePhone(value, defaultCountryCallingCode = "998") {
	if (value == null || String(value).trim() === "") return null;
	const raw = String(value).trim();
	const digits = raw.replace(/\D/g, "");
	if (digits.length < 7 || digits.length > 15)
		throw new TypeError("phone must contain 7..15 digits");
	if (raw.startsWith("+")) return `+${digits}`;
	if (digits.startsWith(defaultCountryCallingCode)) return `+${digits}`;
	if (defaultCountryCallingCode === "998" && digits.length === 9)
		return `+998${digits}`;
	throw new TypeError("phone requires an explicit country code");
}

function normalizedText(value) {
	return String(value ?? "")
		.trim()
		.toLocaleLowerCase("en-US")
		.replace(/\s+/g, " ");
}
export function createContactDedupKey(contact) {
	const email = normalizeEmail(contact.email);
	if (email) return `email:${email}`;
	const phone = normalizePhone(contact.phone);
	if (phone) return `phone:${phone}`;
	const name = normalizedText(
		`${contact.firstName ?? ""} ${contact.lastName ?? ""}`,
	);
	const company = normalizedText(contact.companyName);
	if (name && company) return `name-company:${name}|${company}`;
	return null;
}

export function mapImportRow(row, mapping) {
	if (!row || typeof row !== "object" || Array.isArray(row))
		throw new TypeError("row must be an object");
	const output = {};
	const errors = [];
	for (const [target, source] of Object.entries(mapping)) {
		if (typeof source !== "string" || source === "") {
			errors.push({ target, code: "INVALID_MAPPING" });
			continue;
		}
		output[target] = row[source] ?? null;
	}
	try {
		if ("email" in output) output.email = normalizeEmail(output.email);
	} catch {
		errors.push({ target: "email", code: "INVALID_EMAIL" });
	}
	try {
		if ("phone" in output) output.phone = normalizePhone(output.phone);
	} catch {
		errors.push({ target: "phone", code: "INVALID_PHONE" });
	}
	return { value: output, errors };
}
