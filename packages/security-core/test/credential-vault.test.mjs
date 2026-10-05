import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  CredentialVault,
  InMemoryCredentialKeyProvider,
  createEnvCredentialKeyProvider,
  credentialAuditFingerprint,
  isCredentialEnvelope,
  redactCredential,
} from "../src/index.mjs";

const context = Object.freeze({
  tenantId: "tenant-a",
  resourceType: "OAuthAccount",
  resourceId: "account-1",
  field: "refreshToken",
  purpose: "oauth-token-storage",
});

function createVault(activeKeyId = "key-v1", keys = { "key-v1": randomBytes(32) }) {
  const provider = new InMemoryCredentialKeyProvider({ activeKeyId, keys });
  return { provider, vault: new CredentialVault({ keyProvider: provider }) };
}

test("givenValidContext_whenEncryptingAndDecrypting_thenRoundTripsWithoutPlaintextLeakage", async () => {
  const { provider, vault } = createVault();
  try {
    const envelope = await vault.encryptString("super-secret-token", context);
    assert.equal(isCredentialEnvelope(envelope), true);
    assert.equal(envelope.includes("super-secret-token"), false);
    assert.equal(await vault.decryptString(envelope, context), "super-secret-token");
    assert.equal(vault.inspect(envelope).keyId, "key-v1");
  } finally {
    provider.destroy();
  }
});

test("givenSamePlaintext_whenEncryptedTwice_thenRandomIvProducesDifferentEnvelopes", async () => {
  const { provider, vault } = createVault();
  try {
    const first = await vault.encryptString("same", context);
    const second = await vault.encryptString("same", context);
    assert.notEqual(first, second);
    assert.equal(await vault.decryptString(first, context), "same");
    assert.equal(await vault.decryptString(second, context), "same");
  } finally {
    provider.destroy();
  }
});

test("givenWrongTenantContext_whenDecrypting_thenAuthenticationFails", async () => {
  const { provider, vault } = createVault();
  try {
    const envelope = await vault.encryptString("secret", context);
    await assert.rejects(
      vault.decryptString(envelope, { ...context, tenantId: "tenant-b" }),
      (error) => error.code === "VAULT_DECRYPTION_FAILED",
    );
  } finally {
    provider.destroy();
  }
});

test("givenTamperedCiphertext_whenDecrypting_thenAuthenticationFails", async () => {
  const { provider, vault } = createVault();
  try {
    const envelope = await vault.encryptString("secret", context);
    const encoded = envelope.slice(4);
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const ciphertext = Buffer.from(payload.ct, "base64url");
    ciphertext[0] ^= 1;
    payload.ct = ciphertext.toString("base64url");
    const tampered = "cv1." + Buffer.from(JSON.stringify(payload)).toString("base64url");
    await assert.rejects(vault.decryptString(tampered, context), (error) => error.code === "VAULT_DECRYPTION_FAILED");
  } finally {
    provider.destroy();
  }
});

test("givenMissingHistoricalKey_whenDecrypting_thenFailsWithoutLeakingSecret", async () => {
  const oldKey = randomBytes(32);
  const oldProvider = new InMemoryCredentialKeyProvider({ activeKeyId: "old", keys: { old: oldKey } });
  const oldVault = new CredentialVault({ keyProvider: oldProvider });
  const envelope = await oldVault.encryptString("secret", context);
  oldProvider.destroy();
  oldKey.fill(0);

  const { provider, vault } = createVault("new", { new: randomBytes(32) });
  try {
    await assert.rejects(vault.decryptString(envelope, context), (error) => {
      assert.equal(error.code, "VAULT_KEY_NOT_FOUND");
      assert.equal(String(error).includes("secret"), false);
      return true;
    });
  } finally {
    provider.destroy();
  }
});

test("givenHistoricalKeyAndNewActiveKey_whenRotating_thenReencryptsWithNewKey", async () => {
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  const oldProvider = new InMemoryCredentialKeyProvider({ activeKeyId: "old", keys: { old: oldKey } });
  const oldVault = new CredentialVault({ keyProvider: oldProvider });
  const envelope = await oldVault.encryptString("rotatable", context);
  oldProvider.destroy();

  const provider = new InMemoryCredentialKeyProvider({ activeKeyId: "new", keys: { old: oldKey, new: newKey } });
  const vault = new CredentialVault({ keyProvider: provider });
  try {
    assert.equal(await vault.needsRotation(envelope), true);
    const rotated = await vault.rotate(envelope, context);
    assert.notEqual(rotated, envelope);
    assert.equal(vault.inspect(rotated).keyId, "new");
    assert.equal(await vault.decryptString(rotated, context), "rotatable");
    assert.equal(await vault.needsRotation(rotated), false);
  } finally {
    provider.destroy();
    oldKey.fill(0);
    newKey.fill(0);
  }
});

test("givenPlaintext_whenDecrypting_thenRejectsImplicitLegacyFallback", async () => {
  const { provider, vault } = createVault();
  try {
    await assert.rejects(vault.decryptString("plaintext-token", context), (error) => error.code === "VAULT_PLAINTEXT_REJECTED");
  } finally {
    provider.destroy();
  }
});

test("givenInvalidKeyLength_whenCreatingProvider_thenFailsFast", () => {
  assert.throws(
    () => new InMemoryCredentialKeyProvider({ activeKeyId: "bad", keys: { bad: Buffer.alloc(31) } }),
    (error) => error.code === "VAULT_INVALID_KEY",
  );
});

test("givenEnvironmentKeyring_whenCreatingProvider_thenValidatesAndDecrypts", async () => {
  const key = randomBytes(32);
  const provider = createEnvCredentialKeyProvider({
    env: {
      CREDENTIAL_VAULT_ACTIVE_KEY_ID: "env-v1",
      CREDENTIAL_VAULT_KEYS: JSON.stringify({ "env-v1": key.toString("base64") }),
    },
  });
  const vault = new CredentialVault({ keyProvider: provider });
  try {
    const envelope = await vault.encryptString("secret", context);
    assert.equal(await vault.decryptString(envelope, context), "secret");
  } finally {
    provider.destroy();
    key.fill(0);
  }
});

test("givenEnvelope_whenRedactingAndFingerprinting_thenNeverReturnsPlaintext", async () => {
  const { provider, vault } = createVault();
  try {
    const envelope = await vault.encryptString("sensitive-value", context);
    assert.match(redactCredential(envelope), /^\[REDACTED:CREDENTIAL:/);
    assert.match(credentialAuditFingerprint(envelope), /^[a-f0-9]{64}$/);
    assert.equal(redactCredential("legacy-secret"), "[REDACTED]");
  } finally {
    provider.destroy();
  }
});

test("givenOversizedPlaintext_whenEncrypting_thenRejectsBeforeEncryption", async () => {
  const { provider } = createVault();
  const vault = new CredentialVault({ keyProvider: provider, maxPlaintextBytes: 4 });
  try {
    await assert.rejects(vault.encryptString("12345", context), (error) => error.code === "VAULT_PLAINTEXT_TOO_LARGE");
  } finally {
    provider.destroy();
  }
});
