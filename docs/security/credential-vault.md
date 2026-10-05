# Credential Vault

## Security objective

First-party OAuth tokens, integration credentials and private API keys must not be stored as plaintext application values. The vault introduced in Security R2 provides a versioned `AES-256-GCM` envelope with tenant-bound additional authenticated data (AAD).

## Envelope invariants

- Prefix: `cv1.`
- Algorithm: AES-256-GCM
- Key size: 32 bytes
- Nonce size: 12 bytes generated for every encryption
- Authentication tag: 16 bytes
- AAD binds ciphertext to tenant, resource type, resource ID, field and purpose
- Key ID is stored in the envelope; key material is never stored with ciphertext
- Plaintext fallback is denied by default
- Decryption errors never include plaintext or key material

Changing any ciphertext byte, tag, IV, key, tenant ID, resource ID or field causes authenticated decryption to fail.

## Environment provider

```env
CREDENTIAL_VAULT_ACTIVE_KEY_ID=prod-v2
CREDENTIAL_VAULT_KEYS={"prod-v1":"<base64-32-bytes>","prod-v2":"<base64-32-bytes>"}
CREDENTIAL_VAULT_ENFORCE=true
```

`CREDENTIAL_VAULT_KEYS` is an initial production-compatible environment provider, not a replacement for a cloud KMS/HSM. Deployment systems must inject it through their secret manager. It must never be committed.

## Rotation

1. Add a new key while retaining old keys.
2. Change `CREDENTIAL_VAULT_ACTIVE_KEY_ID` to the new key.
3. New writes use the active key immediately.
4. Backfill old envelopes in bounded, restart-safe batches using `vault.rotate(...)`.
5. Verify that no persisted envelope references the old key.
6. Remove the old key only after backups containing old ciphertext have reached the approved retention boundary.

## Plaintext migration

Use expand/contract rather than an in-place destructive migration:

1. Add nullable encrypted columns.
2. Dual-write encrypted values while continuing compatible reads.
3. Backfill existing plaintext in bounded, idempotent batches.
4. Reconcile counts and perform sampled decrypt verification.
5. Switch reads to encrypted values and reject new plaintext writes.
6. Null and later remove plaintext columns after rollback retention expires.

`createCredentialCodec({ allowLegacyPlaintext: true })` exists only for the controlled migration window and marks every legacy read as `needsMigration: true`. It must not remain enabled indefinitely.

## Logging

Never log plaintext, envelopes, key material, OAuth responses or full third-party error bodies. Use `redactCredential` for defensive redaction and `credentialAuditFingerprint` only when correlation of an encrypted record is required.

## Live KMS work

Cloud KMS adapters and live rotation verification remain external-environment work. The package accepts an asynchronous key-provider contract so a KMS-backed provider can be added without changing encryption callers.
