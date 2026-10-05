import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { TextDecoder } from "node:util";
import { securityError } from "./errors.mjs";

const ENVELOPE_PREFIX = "cv1.";
const ENVELOPE_VERSION = 1;
const ALGORITHM = "A256GCM";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DEFAULT_MAX_PLAINTEXT_BYTES = 64 * 1024;
const DEFAULT_MAX_ENVELOPE_BYTES = 256 * 1024;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function requireNonEmptyString(value, field, maxLength = 256) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw securityError("VAULT_INVALID_CONTEXT", `${field} must be a non-empty string`, {
      safeDetails: { field },
    });
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    throw securityError("VAULT_INVALID_CONTEXT", `${field} contains control characters`, {
      safeDetails: { field },
    });
  }
  return value;
}

function normalizeKeyId(value) {
  if (typeof value !== "string" || !KEY_ID_PATTERN.test(value)) {
    throw securityError("VAULT_INVALID_KEY_ID", "Credential key ID is invalid");
  }
  return value;
}

function encodeBase64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function decodeBase64Url(value, field, { expectedLength, allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw securityError("VAULT_INVALID_ENVELOPE", `Invalid ${field}`, {
      safeDetails: { field },
    });
  }
  if (value.length > 350_000 || (value.length > 0 && !/^[A-Za-z0-9_-]+$/.test(value))) {
    throw securityError("VAULT_INVALID_ENVELOPE", `Invalid ${field}`, {
      safeDetails: { field },
    });
  }
  let decoded;
  try {
    decoded = Buffer.from(value, "base64url");
  } catch (cause) {
    throw securityError("VAULT_INVALID_ENVELOPE", `Invalid ${field}`, {
      cause,
      safeDetails: { field },
    });
  }
  if (encodeBase64Url(decoded) !== value) {
    decoded.fill(0);
    throw securityError("VAULT_INVALID_ENVELOPE", `Non-canonical ${field}`, {
      safeDetails: { field },
    });
  }
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    decoded.fill(0);
    throw securityError("VAULT_INVALID_ENVELOPE", `Invalid ${field} length`, {
      safeDetails: { field },
    });
  }
  return decoded;
}

function decodeConfiguredKey(value, keyId) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw securityError("VAULT_INVALID_KEY", "Configured credential key is invalid", {
      safeDetails: { keyId },
    });
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw securityError("VAULT_INVALID_KEY", "Configured credential key is invalid", {
      safeDetails: { keyId },
    });
  }
  let key;
  try {
    key = Buffer.from(normalized, "base64");
  } catch (cause) {
    throw securityError("VAULT_INVALID_KEY", "Configured credential key is invalid", {
      cause,
      safeDetails: { keyId },
    });
  }
  if (key.length !== KEY_BYTES) {
    key.fill(0);
    throw securityError("VAULT_INVALID_KEY", "Credential key must decode to 32 bytes", {
      safeDetails: { keyId },
    });
  }
  return key;
}

function normalizeContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw securityError("VAULT_INVALID_CONTEXT", "Credential context is required");
  }
  return Object.freeze({
    tenantId: requireNonEmptyString(context.tenantId, "tenantId", 128),
    resourceType: requireNonEmptyString(context.resourceType, "resourceType", 128),
    resourceId: requireNonEmptyString(context.resourceId, "resourceId", 256),
    field: requireNonEmptyString(context.field, "field", 128),
    purpose: requireNonEmptyString(context.purpose ?? "credential-storage", "purpose", 128),
  });
}

function buildAdditionalAuthenticatedData(context) {
  const normalized = normalizeContext(context);
  return Buffer.from(
    JSON.stringify([
      ENVELOPE_VERSION,
      normalized.tenantId,
      normalized.resourceType,
      normalized.resourceId,
      normalized.field,
      normalized.purpose,
    ]),
    "utf8",
  );
}

function parseEnvelope(value, maxEnvelopeBytes) {
  if (typeof value !== "string" || !value.startsWith(ENVELOPE_PREFIX)) {
    throw securityError("VAULT_PLAINTEXT_REJECTED", "Credential is not an encrypted envelope");
  }
  if (Buffer.byteLength(value, "utf8") > maxEnvelopeBytes) {
    throw securityError("VAULT_INVALID_ENVELOPE", "Credential envelope is too large");
  }
  const encoded = value.slice(ENVELOPE_PREFIX.length);
  const payloadBuffer = decodeBase64Url(encoded, "payload");
  let payload;
  try {
    payload = JSON.parse(UTF8_DECODER.decode(payloadBuffer));
  } catch (cause) {
    throw securityError("VAULT_INVALID_ENVELOPE", "Credential envelope payload is invalid", {
      cause,
    });
  } finally {
    payloadBuffer.fill(0);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw securityError("VAULT_INVALID_ENVELOPE", "Credential envelope payload is invalid");
  }
  const allowedKeys = ["alg", "ct", "iv", "kid", "tag", "v"];
  const actualKeys = Object.keys(payload).sort();
  if (actualKeys.length !== allowedKeys.length || actualKeys.some((key, index) => key !== allowedKeys[index])) {
    throw securityError("VAULT_INVALID_ENVELOPE", "Credential envelope shape is invalid");
  }
  if (payload.v !== ENVELOPE_VERSION || payload.alg !== ALGORITHM) {
    throw securityError("VAULT_UNSUPPORTED_ENVELOPE", "Credential envelope version is not supported", {
      safeDetails: { version: payload.v, algorithm: payload.alg },
    });
  }
  const kid = normalizeKeyId(payload.kid);
  const iv = decodeBase64Url(payload.iv, "iv", { expectedLength: IV_BYTES });
  const ciphertext = decodeBase64Url(payload.ct, "ciphertext", { allowEmpty: true });
  const tag = decodeBase64Url(payload.tag, "tag", { expectedLength: TAG_BYTES });
  return { kid, iv, ciphertext, tag };
}

function serializeEnvelope({ kid, iv, ciphertext, tag }) {
  const payload = {
    alg: ALGORITHM,
    ct: encodeBase64Url(ciphertext),
    iv: encodeBase64Url(iv),
    kid,
    tag: encodeBase64Url(tag),
    v: ENVELOPE_VERSION,
  };
  return ENVELOPE_PREFIX + Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export class InMemoryCredentialKeyProvider {
  #activeKeyId;
  #keys;

  constructor({ activeKeyId, keys }) {
    this.#activeKeyId = normalizeKeyId(activeKeyId);
    if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
      throw securityError("VAULT_INVALID_KEYRING", "Credential keyring is invalid");
    }
    this.#keys = new Map();
    for (const [rawKeyId, rawKey] of Object.entries(keys)) {
      const keyId = normalizeKeyId(rawKeyId);
      const key = Buffer.isBuffer(rawKey) ? Buffer.from(rawKey) : decodeConfiguredKey(rawKey, keyId);
      if (key.length !== KEY_BYTES) {
        key.fill(0);
        throw securityError("VAULT_INVALID_KEY", "Credential key must contain 32 bytes", {
          safeDetails: { keyId },
        });
      }
      this.#keys.set(keyId, key);
    }
    if (!this.#keys.has(this.#activeKeyId)) {
      this.destroy();
      throw securityError("VAULT_ACTIVE_KEY_MISSING", "Active credential key is unavailable", {
        safeDetails: { keyId: this.#activeKeyId },
      });
    }
  }

  async getActiveKey() {
    return { keyId: this.#activeKeyId, key: await this.getKey(this.#activeKeyId) };
  }

  async getKey(keyId) {
    const normalizedKeyId = normalizeKeyId(keyId);
    const key = this.#keys.get(normalizedKeyId);
    if (!key) {
      throw securityError("VAULT_KEY_NOT_FOUND", "Credential decryption key is unavailable", {
        safeDetails: { keyId: normalizedKeyId },
      });
    }
    return Buffer.from(key);
  }

  get activeKeyId() {
    return this.#activeKeyId;
  }

  destroy() {
    for (const key of this.#keys.values()) key.fill(0);
    this.#keys.clear();
  }
}

export function createEnvCredentialKeyProvider({
  env = process.env,
  keysVariable = "CREDENTIAL_VAULT_KEYS",
  activeKeyVariable = "CREDENTIAL_VAULT_ACTIVE_KEY_ID",
} = {}) {
  const activeKeyId = env[activeKeyVariable];
  const serializedKeys = env[keysVariable];
  if (!activeKeyId || !serializedKeys) {
    throw securityError("VAULT_CONFIGURATION_MISSING", "Credential vault configuration is missing", {
      safeDetails: { keysVariable, activeKeyVariable },
    });
  }
  let keys;
  try {
    keys = JSON.parse(serializedKeys);
  } catch (cause) {
    throw securityError("VAULT_INVALID_KEYRING", "Credential keyring JSON is invalid", { cause });
  }
  return new InMemoryCredentialKeyProvider({ activeKeyId, keys });
}

export class CredentialVault {
  #keyProvider;
  #maxPlaintextBytes;
  #maxEnvelopeBytes;

  constructor({
    keyProvider,
    maxPlaintextBytes = DEFAULT_MAX_PLAINTEXT_BYTES,
    maxEnvelopeBytes = DEFAULT_MAX_ENVELOPE_BYTES,
  }) {
    if (!keyProvider || typeof keyProvider.getActiveKey !== "function" || typeof keyProvider.getKey !== "function") {
      throw securityError("VAULT_INVALID_PROVIDER", "Credential key provider is invalid");
    }
    if (!Number.isSafeInteger(maxPlaintextBytes) || maxPlaintextBytes < 1) {
      throw securityError("VAULT_INVALID_LIMIT", "maxPlaintextBytes must be a positive safe integer");
    }
    if (!Number.isSafeInteger(maxEnvelopeBytes) || maxEnvelopeBytes < 256) {
      throw securityError("VAULT_INVALID_LIMIT", "maxEnvelopeBytes must be at least 256 bytes");
    }
    this.#keyProvider = keyProvider;
    this.#maxPlaintextBytes = maxPlaintextBytes;
    this.#maxEnvelopeBytes = maxEnvelopeBytes;
  }

  async encryptString(plaintext, context) {
    if (typeof plaintext !== "string") {
      throw securityError("VAULT_INVALID_PLAINTEXT", "Credential plaintext must be a string");
    }
    const plaintextBuffer = Buffer.from(plaintext, "utf8");
    if (plaintextBuffer.length > this.#maxPlaintextBytes) {
      plaintextBuffer.fill(0);
      throw securityError("VAULT_PLAINTEXT_TOO_LARGE", "Credential plaintext exceeds the configured limit");
    }
    const aad = buildAdditionalAuthenticatedData(context);
    const iv = randomBytes(IV_BYTES);
    let key;
    try {
      const active = await this.#keyProvider.getActiveKey();
      const keyId = normalizeKeyId(active.keyId);
      key = Buffer.from(active.key);
      if (active.key && typeof active.key.fill === "function") active.key.fill(0);
      if (key.length !== KEY_BYTES) {
        throw securityError("VAULT_INVALID_KEY", "Credential key must contain 32 bytes", {
          safeDetails: { keyId },
        });
      }
      const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(aad, { plaintextLength: plaintextBuffer.length });
      const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
      const tag = cipher.getAuthTag();
      try {
        return serializeEnvelope({ kid: keyId, iv, ciphertext, tag });
      } finally {
        ciphertext.fill(0);
        tag.fill(0);
      }
    } catch (cause) {
      if (cause?.code?.startsWith?.("VAULT_")) throw cause;
      throw securityError("VAULT_ENCRYPTION_FAILED", "Credential encryption failed", { cause });
    } finally {
      plaintextBuffer.fill(0);
      aad.fill(0);
      iv.fill(0);
      if (key) key.fill(0);
    }
  }

  async decryptString(envelope, context) {
    const parsed = parseEnvelope(envelope, this.#maxEnvelopeBytes);
    const aad = buildAdditionalAuthenticatedData(context);
    let key;
    let plaintext;
    try {
      key = Buffer.from(await this.#keyProvider.getKey(parsed.kid));
      if (key.length !== KEY_BYTES) {
        throw securityError("VAULT_INVALID_KEY", "Credential key must contain 32 bytes", {
          safeDetails: { keyId: parsed.kid },
        });
      }
      const decipher = createDecipheriv("aes-256-gcm", key, parsed.iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(aad, { plaintextLength: parsed.ciphertext.length });
      decipher.setAuthTag(parsed.tag);
      plaintext = Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]);
      try {
        return UTF8_DECODER.decode(plaintext);
      } catch (cause) {
        throw securityError("VAULT_INVALID_PLAINTEXT", "Decrypted credential is not valid UTF-8", { cause });
      }
    } catch (cause) {
      if (cause?.code?.startsWith?.("VAULT_") && cause.code !== "VAULT_DECRYPTION_FAILED") throw cause;
      throw securityError("VAULT_DECRYPTION_FAILED", "Credential decryption failed", { cause });
    } finally {
      aad.fill(0);
      parsed.iv.fill(0);
      parsed.ciphertext.fill(0);
      parsed.tag.fill(0);
      if (key) key.fill(0);
      if (plaintext) plaintext.fill(0);
    }
  }

  inspect(envelope) {
    const parsed = parseEnvelope(envelope, this.#maxEnvelopeBytes);
    try {
      return Object.freeze({
        version: ENVELOPE_VERSION,
        algorithm: ALGORITHM,
        keyId: parsed.kid,
        ciphertextBytes: parsed.ciphertext.length,
      });
    } finally {
      parsed.iv.fill(0);
      parsed.ciphertext.fill(0);
      parsed.tag.fill(0);
    }
  }

  async needsRotation(envelope) {
    const metadata = this.inspect(envelope);
    const active = await this.#keyProvider.getActiveKey();
    const activeKey = Buffer.from(active.key);
    activeKey.fill(0);
    if (active.key && typeof active.key.fill === "function") active.key.fill(0);
    return metadata.keyId !== active.keyId;
  }

  async rotate(envelope, context) {
    if (!(await this.needsRotation(envelope))) return envelope;
    const plaintext = await this.decryptString(envelope, context);
    try {
      return await this.encryptString(plaintext, context);
    } finally {
      // JavaScript strings cannot be reliably zeroized; callers must avoid retaining them.
    }
  }
}

export function isCredentialEnvelope(value) {
  if (typeof value !== "string" || !value.startsWith(ENVELOPE_PREFIX)) return false;
  try {
    const parsed = parseEnvelope(value, DEFAULT_MAX_ENVELOPE_BYTES);
    parsed.iv.fill(0);
    parsed.ciphertext.fill(0);
    parsed.tag.fill(0);
    return true;
  } catch {
    return false;
  }
}

export function redactCredential(value) {
  if (isCredentialEnvelope(value)) {
    const encoded = value.slice(ENVELOPE_PREFIX.length);
    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      return `[REDACTED:CREDENTIAL:${typeof payload.kid === "string" ? payload.kid : "UNKNOWN"}]`;
    } catch {
      return "[REDACTED:CREDENTIAL]";
    }
  }
  return value == null ? value : "[REDACTED]";
}

export function credentialAuditFingerprint(envelope) {
  if (!isCredentialEnvelope(envelope)) {
    throw securityError("VAULT_PLAINTEXT_REJECTED", "Credential is not an encrypted envelope");
  }
  return createHash("sha256").update(envelope, "utf8").digest("hex");
}

export const credentialVaultConstants = Object.freeze({
  envelopePrefix: ENVELOPE_PREFIX,
  version: ENVELOPE_VERSION,
  algorithm: ALGORITHM,
  keyBytes: KEY_BYTES,
  ivBytes: IV_BYTES,
  tagBytes: TAG_BYTES,
});
