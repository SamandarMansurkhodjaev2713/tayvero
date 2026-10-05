# Security R2 Delivery

## Delivered

- `@crm/security-core`
- Versioned AES-256-GCM credential envelopes
- Tenant/resource/field-bound authenticated context
- Key-provider abstraction and environment provider
- Key rotation and explicit plaintext migration codec
- Tenant context and scoped delegate primitives
- Tenant-bound idempotency keys
- Security configuration gate
- Tenant static audit ratchet
- Unit and adversarial tests
- ADR, standards and rotation runbook

## Status semantics

The reusable security primitives are implemented and unit-verifiable. End-to-end tenant isolation and encrypted persistence are still `IN_PROGRESS` until existing consumers and database columns are migrated and integration-tested. No adapter-only work is mislabeled as a completed application feature.

## Commands

```bash
bun run test:security-core
bun run security:config-check
bun run security:tenant-audit
bun run security:gate
```

## Next safe production batch

1. Inventory all tenant-owned models and direct access paths using the generated tenant audit report.
2. Establish trusted tenant context at HTTP, API-key, job and agent boundaries.
3. Migrate one vertical slice at a time to tenant-scoped repositories with DB-backed cross-tenant tests.
4. Add encrypted credential columns using expand/contract migration.
5. Dual-write, backfill, reconcile and then enforce encrypted reads.
