# Tenant Isolation Standard

Tenant ownership is a security boundary, not a UI filter.

## Runtime contract

Every authenticated request, API key invocation, job and agent run must carry an immutable tenant context derived from trusted server-side authentication data. A caller-supplied workspace or organization ID is never accepted as proof of access.

The `@crm/security-core` package provides:

- validated immutable tenant context;
- tenant-scoped query/create/update argument builders;
- a fail-closed scoped delegate;
- result-side invariant checks;
- tenant-bound idempotency keys;
- rejection of ownership reassignment and prototype-pollution keys.

## Required application pattern

```js
const scopedDeals = createTenantScopedDelegate({
  delegate: prisma.deal,
  context: request.tenant,
});

const deals = await scopedDeals.findMany({
  where: { status: "OPEN" },
  take: 100,
});
```

The tenant field is injected server-side. If an underlying delegate returns a record from another tenant, the wrapper fails closed instead of returning the record.

## Static audit ratchet

`bun run security:tenant-audit` scans tenant-owned Prisma models and hardcoded tenant identifiers. The baseline records reviewed legacy findings. CI fails when new findings are introduced.

This scanner is deliberately documented as a **ratchet**, not proof. It cannot understand every alias, relation traversal or dynamic query. Full closure requires route/repository migration plus database-backed cross-tenant integration tests.

## Required tests before marking tenant isolation complete

- Tenant A cannot read, update or delete Tenant B entities.
- Search and export cannot reveal Tenant B entities.
- Foreign relation traversal cannot cross the boundary.
- API keys and agents remain tenant-scoped.
- Background jobs restore the trusted tenant context.
- Bulk operations and import/export are scoped.
- Cache keys, idempotency keys and object-storage paths include tenant identity.

## Error semantics

External callers should generally receive a non-enumerating not-found/forbidden response. Internal logs may record a tenant mismatch using correlation identifiers, but must not disclose the foreign record payload.
