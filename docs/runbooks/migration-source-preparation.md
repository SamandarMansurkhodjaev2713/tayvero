# Operator-only durable source preparation

Status: local filesystem and child-process tests VERIFIED; public upload/API/UI,
real database deduplication and CRM importer are NOT implemented by this utility.
Every output is `PREPARATION_ONLY`, `crmWrites=false`,
`databaseDedupeVerified=false`. This is useful preparation, not a completed import.

## Deployment boundary

Use Node 22 and a private persistent POSIX volume owned by the service account.
Do not use a serverless/ephemeral disk, shared writable directory or untrusted
symlink chain. Source directories are private (0700); envelopes are private (0600).
AES-256-GCM binds the source to its tenant, source identity and key identity.
Reads authenticate metadata/content and verify the expected SHA-256. Files are
published exclusively and synced; local tests include tampering, key rotation,
wrong tenant, fresh-process recovery, collisions and symlink rejection. These
are not power-loss, distributed object-store or disaster-recovery certifications.

Provide through an approved local environment/secret manager:

- `MIGRATION_SOURCE_ROOT`: absolute private persistent directory.
- `MIGRATION_SOURCE_KEY_HEX`: 32 random bytes encoded as 64 hex characters.
- `MIGRATION_TENANT_ID`: trusted deployment/workspace identity.
- `MIGRATION_ACTOR_ID`: authorized operator identity.

These are trusted operator inputs, NOT client-supplied authorization. The library
supports a key ring, but this CLI uses key ID `operator_v1`. Retain that key for
all existing sources. Do not simply replace it and expect historical files to
remain readable; a versioned key-rotation adapter/migration is separate work.
No encryption key is generated silently. Never paste it into a chat or report.

## Upload/preview

From the repository root, with the environment already configured:

```sh
node --import ./tools/quality/register-workspaces.mjs \
  tools/migrations/prepare-source.mjs upload \
  --file /private/input/customers.csv \
  --out /private/reports/customers-preview.json
```

CSV/TSV must be valid UTF-8; invalid bytes are rejected, not silently replaced.
The preparation lane is bounded to 4 MiB, 50,000 data rows, 200 columns and 100,000
characters per field. XLSX is explicitly rejected until a bounded worksheet
adapter is implemented. Empty files, invalid formats and unsafe input files fail.
The preview has up to 20 rows and reports their actual physical source line numbers.

## Mapping and dry-run plan

Example mapping file (not a complete CRM schema or referential-integrity check):

```json
{
  "entityType": "contact",
  "mapping": [{"source": "Email", "target": "email"}],
  "targetSchema": {"email": {"type": "email", "required": true}},
  "batchSize": 500
}
```

Use `source.id` and `source.sha256` from the private preview report:

```sh
node --import ./tools/quality/register-workspaces.mjs \
  tools/migrations/prepare-source.mjs plan \
  --source <source-id> --sha256 <sha256> \
  --definition /private/input/mapping.json \
  --out /private/reports/customers-plan.json
```

A new process reads/decrypts the original persisted source; it does not trust
browser-provided preview rows or an in-memory cached file. The plan validates
mapping and accounts for rows. Supplied dedupe keys are operator inputs, not a
verified live CRM snapshot. An actual importer must still validate permissions,
owners/pipelines/custom fields, uniqueness and transactions against the database.

Output paths are created exclusively (no overwrite), with mode 0600. Report files
contain customer data: keep their parent directory private, do not commit or
attach them as general quality evidence. A failed attempt may leave an empty
reserved report; this is not a valid completion report. The CLI deliberately does
not delete an error-path pathname that another process could have replaced.

## Operational work still required

Retention, encrypted backup/restore, quotas, disk monitoring and secure key custody
must be supplied by the deployment. Multi-host object storage, authenticated upload,
job scheduling, real CRM writes, durable row receipts, rollback execution and
Migration Center UI belong to subsequent scopes. Re-importing identical bytes
is a new import intent; file SHA is evidence identity, not a global uniqueness lock.
