import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set([
	"localhost",
	"metadata.google.internal",
	"metadata",
	"host.docker.internal",
]);
function ipv4Parts(value) {
	const parts = value.split(".").map(Number);
	return parts.length === 4 &&
		parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
		? parts
		: null;
}
export function isForbiddenIp(value) {
	const version = isIP(value);
	if (version === 4) {
		const [a, b] = ipv4Parts(value);
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && [0, 2, 168].includes(b)) ||
			(a === 198 && [18, 19, 51].includes(b)) ||
			(a === 203 && b === 0) ||
			a >= 224
		);
	}
	if (version === 6) {
		const normalized = value.toLowerCase().split("%")[0];
		if (normalized.startsWith("::ffff:"))
			return isForbiddenIp(normalized.slice(7));
		return (
			normalized === "::" ||
			normalized === "::1" ||
			normalized.startsWith("fc") ||
			normalized.startsWith("fd") ||
			/^fe[89ab]/.test(normalized) ||
			normalized.startsWith("ff") ||
			normalized.startsWith("2001:db8:")
		);
	}
	return true;
}
function forbiddenHostname(hostname) {
	const normalized = hostname.toLowerCase().replace(/\.$/, "");
	return (
		BLOCKED_HOSTS.has(normalized) ||
		normalized.endsWith(".localhost") ||
		normalized.endsWith(".local") ||
		normalized.endsWith(".internal")
	);
}

export function validateOutboundUrl(value, policy = {}) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError("Connector URL is invalid");
	}
	const allowedProtocols = policy.allowedProtocols ?? ["https:"];
	if (!allowedProtocols.includes(url.protocol))
		throw new TypeError(`Protocol ${url.protocol} is not allowed`);
	if (url.username || url.password)
		throw new TypeError("Credentials in connector URL are prohibited");
	if (forbiddenHostname(url.hostname))
		throw new TypeError("Connector hostname is prohibited");
	if (isIP(url.hostname) && isForbiddenIp(url.hostname))
		throw new TypeError("Connector IP address is private, reserved, or unsafe");
	if (
		Array.isArray(policy.allowedHosts) &&
		!policy.allowedHosts.includes(url.hostname.toLowerCase())
	)
		throw new TypeError("Connector hostname is outside the allowlist");
	if (
		url.port &&
		Array.isArray(policy.allowedPorts) &&
		!policy.allowedPorts.includes(Number(url.port))
	)
		throw new TypeError("Connector port is outside the allowlist");
	url.hash = "";
	return url;
}

export async function resolveAndValidateOutboundUrl(
	value,
	policy = {},
	lookup = dnsLookup,
) {
	const url = validateOutboundUrl(value, policy);
	if (isIP(url.hostname)) return url;
	const results = await lookup(url.hostname, { all: true, verbatim: true });
	if (!Array.isArray(results) || results.length === 0)
		throw new TypeError("Connector hostname did not resolve");
	for (const result of results)
		if (isForbiddenIp(result.address))
			throw new TypeError(
				"Connector hostname resolves to a private, reserved, or unsafe address",
			);
	return url;
}

export async function validateRedirectTarget(
	currentUrl,
	location,
	policy = {},
	lookup = dnsLookup,
) {
	const target = new URL(location, currentUrl);
	return resolveAndValidateOutboundUrl(target.toString(), policy, lookup);
}
