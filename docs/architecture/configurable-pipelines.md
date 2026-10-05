
# Configurable pipelines

## Decision

Legacy `DealStage` remains untouched during this release. New pipelines are introduced through additive sidecar tables:

- `CrmPipeline`;
- `CrmPipelineStage`;
- `CrmDealPipelineAssignment`.

This is an expand/contract migration. It avoids a destructive enum replacement and permits dual-read/dual-write, reconciliation and rollback before the legacy column is retired.

## Invariants

- all records are tenant-owned through `workspaceId`;
- stage identity is scoped by tenant and pipeline;
- a deal has at most one assignment per tenant;
- stage and pipeline foreign keys include `workspaceId`;
- stage position and key are unique inside a pipeline;
- terminal probability is deterministic (`WON=100%`, `LOST=0%`);
- only one active default pipeline is allowed per workspace;
- stale updates are rejected through an assignment version;
- reopening a terminal deal requires an explicit permission;
- pipeline analytics use integer minor units, never floating point.

## Next transport slice

`CRM-PIPE-API-002` must connect the domain and persistence adapter to trusted tenant procedures, enforce object/action permissions, emit audit events, and add PostgreSQL-backed cross-tenant and concurrency tests before UI work is marked implemented.
