import { fail } from "./errors.mjs";

export function normalizeEmail(value) {
	if (typeof value !== "string")
		fail("INVALID_EMAIL", "Email must be a string");
	const email = value.trim().toLowerCase();
	if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
		fail("INVALID_EMAIL", "Email is not valid", { value });
	return email;
}

export function normalizeUzbekistanPhone(value) {
	if (typeof value !== "string" && typeof value !== "number")
		fail("INVALID_PHONE", "Phone must be text or a number");
	let digits = String(value).replace(/\D/g, "");
	if (digits.startsWith("00")) digits = digits.slice(2);
	if (digits.length === 9) digits = `998${digits}`;
	if (digits.length === 10 && digits.startsWith("8"))
		digits = `998${digits.slice(1)}`;
	if (!/^998\d{9}$/.test(digits))
		fail("INVALID_PHONE", "Phone cannot be normalized to Uzbekistan E.164", {
			value,
		});
	return `+${digits}`;
}

export function parseMoneyMinor(value, scale = 2) {
	if (!Number.isInteger(scale) || scale < 0 || scale > 6)
		fail(
			"INVALID_MONEY_SCALE",
			"Money scale must be an integer between 0 and 6",
		);
	if (typeof value !== "string" && typeof value !== "number")
		fail("INVALID_MONEY", "Money value must be text or a number");
	const text = String(value).trim();
	if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text))
		fail(
			"INVALID_MONEY",
			"Money value must use a dot decimal separator and no grouping separators",
			{ value },
		);
	const negative = text.startsWith("-");
	const unsigned = negative ? text.slice(1) : text;
	const [whole, fraction = ""] = unsigned.split(".");
	if (fraction.length > scale)
		fail(
			"MONEY_PRECISION",
			"Money value has more fractional digits than configured",
			{ value, scale },
		);
	const minor =
		BigInt(whole) * 10n ** BigInt(scale) +
		BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
	return (negative ? -minor : minor).toString();
}

export function normalizeCompanyName(value) {
	if (typeof value !== "string")
		fail("INVALID_COMPANY_NAME", "Company name must be a string");
	const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
	if (normalized.length === 0 || normalized.length > 300)
		fail("INVALID_COMPANY_NAME", "Company name length is invalid");
	return normalized;
}
