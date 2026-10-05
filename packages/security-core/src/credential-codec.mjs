import { isCredentialEnvelope } from "./credential-vault.mjs";
import { securityError } from "./errors.mjs";

export function createCredentialCodec({
	vault,
	contextFactory,
	allowLegacyPlaintext = false,
}) {
	if (
		!vault ||
		typeof vault.encryptString !== "function" ||
		typeof vault.decryptString !== "function"
	) {
		throw securityError(
			"CREDENTIAL_CODEC_INVALID_VAULT",
			"Credential codec requires a valid vault",
		);
	}
	if (typeof contextFactory !== "function") {
		throw securityError(
			"CREDENTIAL_CODEC_INVALID_CONTEXT_FACTORY",
			"Credential codec requires a context factory",
		);
	}

	const contextFor = (record, field) => {
		const context = contextFactory(record, field);
		if (!context || typeof context !== "object") {
			throw securityError(
				"CREDENTIAL_CODEC_INVALID_CONTEXT",
				"Credential context factory returned an invalid value",
			);
		}
		return context;
	};

	return Object.freeze({
		async seal(value, record, field) {
			if (value == null) return value;
			if (typeof value !== "string") {
				throw securityError(
					"CREDENTIAL_CODEC_INVALID_VALUE",
					"Credential must be a string or null",
					{
						safeDetails: { field },
					},
				);
			}
			if (isCredentialEnvelope(value)) {
				throw securityError(
					"CREDENTIAL_CODEC_DOUBLE_ENCRYPTION",
					"Credential is already encrypted",
					{
						safeDetails: { field },
					},
				);
			}
			return vault.encryptString(value, contextFor(record, field));
		},

		async open(value, record, field) {
			if (value == null) return { plaintext: value, needsMigration: false };
			if (typeof value !== "string") {
				throw securityError(
					"CREDENTIAL_CODEC_INVALID_VALUE",
					"Stored credential must be a string or null",
					{
						safeDetails: { field },
					},
				);
			}
			if (!isCredentialEnvelope(value)) {
				if (!allowLegacyPlaintext) {
					throw securityError(
						"CREDENTIAL_CODEC_PLAINTEXT_REJECTED",
						"Plaintext credential storage is disabled",
						{
							safeDetails: { field },
						},
					);
				}
				return { plaintext: value, needsMigration: true };
			}
			return {
				plaintext: await vault.decryptString(value, contextFor(record, field)),
				needsMigration: await vault.needsRotation(value),
			};
		},

		async rotate(value, record, field) {
			if (value == null) return value;
			if (!isCredentialEnvelope(value)) {
				if (!allowLegacyPlaintext) {
					throw securityError(
						"CREDENTIAL_CODEC_PLAINTEXT_REJECTED",
						"Plaintext credential storage is disabled",
						{
							safeDetails: { field },
						},
					);
				}
				return vault.encryptString(value, contextFor(record, field));
			}
			return vault.rotate(value, contextFor(record, field));
		},
	});
}
