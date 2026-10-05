import { Buffer } from "node:buffer";

function fail(message) {
  process.stderr.write(`SECURITY_CONFIG_ERROR: ${message}\n`);
  process.exitCode = 1;
}

function decodeKey(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  try {
    return Buffer.from(normalized, "base64");
  } catch {
    return null;
  }
}

const production = process.env.NODE_ENV === "production";
const enforced = production || process.env.CREDENTIAL_VAULT_ENFORCE === "true";
const activeKeyId = process.env.CREDENTIAL_VAULT_ACTIVE_KEY_ID;
const serializedKeys = process.env.CREDENTIAL_VAULT_KEYS;

if (!activeKeyId && !serializedKeys && !enforced) {
  process.stdout.write("Credential vault configuration is optional in this non-production verification context.\n");
  process.exit(0);
}

if (!activeKeyId || !serializedKeys) {
  fail("CREDENTIAL_VAULT_ACTIVE_KEY_ID and CREDENTIAL_VAULT_KEYS must be configured together");
  process.exit();
}

let keyring;
try {
  keyring = JSON.parse(serializedKeys);
} catch {
  fail("CREDENTIAL_VAULT_KEYS must be a JSON object");
  process.exit();
}

if (!keyring || typeof keyring !== "object" || Array.isArray(keyring)) {
  fail("CREDENTIAL_VAULT_KEYS must be a JSON object");
  process.exit();
}

if (!Object.hasOwn(keyring, activeKeyId)) {
  fail("The active credential key ID is not present in the keyring");
}

for (const [keyId, encoded] of Object.entries(keyring)) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(keyId)) {
    fail(`Invalid credential key ID: ${keyId}`);
    continue;
  }
  if (typeof encoded !== "string") {
    fail(`Credential key ${keyId} must be a Base64 string`);
    continue;
  }
  if (/PLACEHOLDER|CHANGE_ME|BASE64_32_BYTE_KEY/i.test(encoded)) {
    if (enforced) fail(`Credential key ${keyId} still uses a placeholder`);
    continue;
  }
  const decoded = decodeKey(encoded);
  if (!decoded || decoded.length !== 32) {
    fail(`Credential key ${keyId} must decode to exactly 32 bytes`);
  }
  decoded?.fill(0);
}

if (!process.exitCode) {
  process.stdout.write(`Credential vault configuration is structurally valid (${Object.keys(keyring).length} key(s); material redacted).\n`);
}
