// Evidence files must not retain configured credentials, including disposable CI keys.
export function createEvidenceRedactor(env = process.env) {
	const values = [
		env.DATABASE_URL,
		env.TEST_DATABASE_URL,
		env.BETTER_AUTH_SECRET,
		env.AGENT_BRIDGE_SECRET,
		env.CREDENTIAL_VAULT_KEYS,
	];
	try {
		const ring = JSON.parse(env.CREDENTIAL_VAULT_KEYS ?? "{}");
		values.push(
			...Object.values(ring).filter((value) => typeof value === "string"),
		);
	} catch {
		// Preserve invalid-config diagnostics without exposing the original config.
	}
	const secrets = [
		...new Set(
			values.filter((value) => typeof value === "string" && value.length > 0),
		),
	].sort((a, b) => b.length - a.length);
	return (text) => {
		let result = String(text ?? "");
		for (const value of secrets)
			result = result.split(value).join("[REDACTED_CREDENTIAL]");
		return result.replace(
			/postgres(?:ql)?:\/\/[^\s"'<>]+/gi,
			"[REDACTED_DATABASE_URL]",
		);
	};
}
