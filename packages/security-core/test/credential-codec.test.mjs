import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  CredentialVault,
  InMemoryCredentialKeyProvider,
  createCredentialCodec,
  isCredentialEnvelope,
} from "../src/index.mjs";

const record = { id: "connection-1", workspaceId: "tenant-a" };
const contextFactory = (entry, field) => ({
  tenantId: entry.workspaceId,
  resourceType: "IntegrationConnection",
  resourceId: entry.id,
  field,
  purpose: "integration-credential",
});

function setup(activeKeyId = "v1", keys = { v1: randomBytes(32) }, allowLegacyPlaintext = false) {
  const provider = new InMemoryCredentialKeyProvider({ activeKeyId, keys });
  const vault = new CredentialVault({ keyProvider: provider });
  const codec = createCredentialCodec({ vault, contextFactory, allowLegacyPlaintext });
  return { provider, vault, codec };
}

test("givenPlainCredential_whenSealingAndOpening_thenReturnsValidatedPlaintext", async () => {
  const { provider, codec } = setup();
  try {
    const stored = await codec.seal("token", record, "accessToken");
    assert.equal(isCredentialEnvelope(stored), true);
    assert.deepEqual(await codec.open(stored, record, "accessToken"), {
      plaintext: "token",
      needsMigration: false,
    });
  } finally {
    provider.destroy();
  }
});

test("givenLegacyPlaintextAndStrictMode_whenOpening_thenRejects", async () => {
  const { provider, codec } = setup();
  try {
    await assert.rejects(codec.open("legacy", record, "accessToken"), (error) => error.code === "CREDENTIAL_CODEC_PLAINTEXT_REJECTED");
  } finally {
    provider.destroy();
  }
});

test("givenLegacyPlaintextAndMigrationMode_whenOpening_thenMarksMigrationRequired", async () => {
  const { provider, codec } = setup("v1", { v1: randomBytes(32) }, true);
  try {
    assert.deepEqual(await codec.open("legacy", record, "accessToken"), {
      plaintext: "legacy",
      needsMigration: true,
    });
    const migrated = await codec.rotate("legacy", record, "accessToken");
    assert.equal(isCredentialEnvelope(migrated), true);
  } finally {
    provider.destroy();
  }
});

test("givenEncryptedValue_whenSealingAgain_thenPreventsDoubleEncryption", async () => {
  const { provider, codec } = setup();
  try {
    const stored = await codec.seal("token", record, "accessToken");
    await assert.rejects(codec.seal(stored, record, "accessToken"), (error) => error.code === "CREDENTIAL_CODEC_DOUBLE_ENCRYPTION");
  } finally {
    provider.destroy();
  }
});
