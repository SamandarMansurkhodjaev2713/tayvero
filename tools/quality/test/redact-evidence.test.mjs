import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceRedactor } from "../lib/redact-evidence.mjs";

test("acceptance evidence removes configured keys, key ring and database credentials", () => {
	const env = {
		DATABASE_URL: "postgresql://user:password@localhost/build",
		TEST_DATABASE_URL: "postgres://user:password@localhost/check_test",
		BETTER_AUTH_SECRET: "auth-secret-value",
		AGENT_BRIDGE_SECRET: "bridge-secret-value",
		CREDENTIAL_VAULT_KEYS: '{"job":"vault-secret-value"}',
	};
	const redact = createEvidenceRedactor(env);
	const result = redact(
		[
			...Object.values(env),
			"vault-secret-value",
			"postgresql://other:password@localhost/unknown",
			"diagnostic remains",
		].join("\n"),
	);
	for (const value of [...Object.values(env), "vault-secret-value", "password"])
		assert.equal(result.includes(value), false);
	assert.equal(result.includes("diagnostic remains"), true);
});

test("evidence redaction handles absent or invalid key-ring configuration without losing diagnostics", () => {
	assert.equal(createEvidenceRedactor({})(null), "");
	assert.equal(
		createEvidenceRedactor({ CREDENTIAL_VAULT_KEYS: "invalid-secret-config" })(
			"invalid-secret-config failed validation",
		),
		"[REDACTED_CREDENTIAL] failed validation",
	);
});
