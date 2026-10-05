# ADR 0009: Route agent-run side effects through one governed entrypoint

- **Status:** Accepted
- **Date:** 2026-09-01

## Context

The original runner resolved manifest action types through `AGENT_ACTION_EXECUTORS` and called CRM/Slack side-effect functions directly. That path maintained an `AgentAction` business ledger, but it bypassed the newer tenant-bound receipt, policy, approval, output-validation and redacted-audit boundary. Two execution paths could therefore drift in idempotency and failure semantics.

## Decision

`@crm/action-registry` remains a catalog only. Agent tools call an application-owned bridge that composes the catalog with `@crm/agent-action-runtime` and durable Prisma stores.

The bridge:

1. loads the active persisted run and immutable manifest;
2. derives trusted context server-side;
3. verifies exact manifest action and data scope;
4. invokes the governed runtime;
5. passes the complete idempotency/operation envelope to the low-level side effect.

The low-level functions are renamed to make their boundary explicit and are allowed only in the bridge and their defining module. Static audit plus regression tests enforce this rule.

`run.summary` remains run-control state because it does not invoke an external provider or create an independent business side effect.

## Alternatives considered

### Keep the legacy executor map

Rejected. It would preserve a parallel policy and idempotency path and make future action additions easy to implement unsafely.

### Move all business-ledger behavior into the generic runtime immediately

Rejected for this migration. `AgentAction` is part of existing product behavior and run-completion checks. Removing it in the same change would expand regression risk. The generic receipt and user-visible business ledger instead have separate documented responsibilities.

### Let tools invoke the registry directly

Rejected. A catalog-level execute API would allow callers to bypass application authorization and policy composition.

## Consequences

### Positive

- one fail-closed side-effect path;
- complete provider idempotency envelope propagation;
- consistent timeout, cancellation, policy and audit semantics;
- no direct low-level calls from model-facing tools;
- legacy bypasses become release-blocking findings.

### Costs

- two durable ledgers remain during the compatibility period;
- execution performs repeated run/manifest checks to close time-of-check/time-of-use gaps;
- full verification still requires PostgreSQL and live provider environments.

## Invariants

- model input never supplies tenant, permissions, receipt state or operation digest;
- every mutating action has a stable idempotency identity;
- the exact request ID is bound to the run and call ID;
- low-level side effects cannot be called from another production module;
- a failed failure-state write is observable and cannot erase the original failure evidence;
- no action is considered complete until its output passes runtime validation.
