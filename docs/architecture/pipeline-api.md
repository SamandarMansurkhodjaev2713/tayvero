# Configurable pipeline API

## Transport

The `pipelines` tRPC/REST surface provides list, detail, create, update, set-default, archive and restore operations. Every mutation requires an idempotency key and every update/archive/restore uses optimistic versioning.

## Trust boundary

```text
signed-in session
→ activeOrganizationId
→ Member(organizationId, userId)
→ role-derived permissions
→ PipelineRuntimeContext
→ tenant-scoped repository
```

No public input schema accepts `tenantId`, `workspaceId` or `organizationId`.

## Persistence

`CrmPipelineCommandReceipt` stores one result per workspace/action/idempotency key. `CrmPipelineAuditEvent` stores actor, request correlation, action and payload hash. Both are additive tables; the legacy stage enum is not modified.

## Default selection

The first pipeline is always made default inside the same serializable transaction that checks the workspace pipeline count. A later create may explicitly request `isDefault=true`; persistence atomically demotes the previous active default, increments its optimistic version, and creates the requested pipeline as the sole default. Omitting the field remains backward compatible and is treated as `false`.

## Stage updates

Existing stage IDs are preserved. New stages receive server-generated IDs. The adapter temporarily neutralizes stored stage positions and keys before applying a reorder, preventing transient unique-index conflicts when two stages swap positions or keys. A stage with deal assignments cannot be removed.

## UI

Workspace settings expose a functional editor with loading, error, empty and success behavior; keyboard-focusable controls; deterministic terminal probabilities; transition selection; stage reordering; archive/restore; and default-pipeline selection.
