# ADR-0003: Credential Vault and Explicit Tenant Boundaries

## Status

Accepted for incremental adoption.

## Context

The CRM persists credentials for third-party integrations and contains legacy single-workspace assumptions. Plaintext secrets and implicit workspace filters are not adequate security boundaries for a multi-tenant or dedicated-enterprise product.

## Decision

1. Introduce a versioned AES-256-GCM credential envelope with tenant-bound AAD and pluggable asynchronous key providers.
2. Deny implicit plaintext decryption; support legacy values only through an explicit migration mode.
3. Introduce validated immutable tenant context and fail-closed tenant-scoping helpers.
4. Add a static tenant-audit ratchet to CI while legacy routes are migrated.
5. Use expand/contract migrations for both tenant-model and credential-storage changes.

## Alternatives considered

- Database-only transparent encryption: rejected because it does not bind access to application tenant context and complicates per-field rotation/audit.
- One global hardcoded workspace: rejected because it cannot support secure shared SaaS and obscures authorization defects.
- A generic Prisma proxy exposing every operation: rejected because unique operations, nested writes and relation traversal require explicit review; an overly magical proxy could create false confidence.
- Immediate destructive rewrite of all credential columns: rejected because rollback and mixed-version deployments would be unsafe.

## Consequences

- Callers must supply trusted tenant context.
- Credential migrations require dual-write/backfill/reconciliation.
- Historical keys must remain available through backup retention.
- Static scanning reduces regressions but does not replace integration tests.
- Existing direct Prisma access remains a tracked migration surface until every tenant-owned path adopts scoped repositories or equivalent verified authorization.
