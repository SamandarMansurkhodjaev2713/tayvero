# Delivery: legacy agent-action callsite migration

## Scope

`AGENT-ACTION-INTEGRATION-004-LEGACY-CALLSITE-MIGRATION`

## Implemented

- Removed the production `AGENT_ACTION_EXECUTORS` dispatch path.
- Classified action capabilities as `GOVERNED` or `RUN_CONTROL`.
- Connected CRM activity and Slack tools to one governed application bridge.
- Added trusted run context derived from persisted AgentRun and immutable manifest data.
- Revalidated manifest action, CRM record scope and Slack destination before execution.
- Propagated cancellation, provider idempotency key, canonical operation digest and attempt number to the side-effect boundary.
- Preserved the user-visible `AgentAction` ledger while placing it behind the durable governed receipt.
- Renamed low-level functions and made any caller outside the bridge a blocking audit finding.
- Rejected accessor-backed/untrusted request objects and ambiguous identifier separators before hashing or execution.
- Added claim-aware failure persistence that preserves both business failure and state-write failure evidence.
- Added deterministic unit, contract, adversarial, static-boundary and repository regression coverage.

## Verification classification

The batch is `INTEGRATION_VERIFIED` when the generated release report states `criticalChecksPassed=true`.

This classification proves the dependency-free runtime, composition and static boundary in the available environment. It does not claim:

- live PostgreSQL transaction/concurrency behavior;
- live Slack delivery;
- staging tenant/authentication E2E;
- dependency-backed semantic typecheck or production build when Bun/dependencies are unavailable.

## Rollback

Rollback requires restoring the previous tool imports and legacy runtime functions together. Do not partially roll back only the bridge: that would leave model-facing tools without a valid execution path. Existing `GovernedActionReceipt` and `AgentAction` rows are additive and may remain for forensic/reconciliation purposes.
