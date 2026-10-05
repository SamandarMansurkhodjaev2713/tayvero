# Governed action catalog and execution runtime

## Boundary

`@crm/action-registry` is a **catalog only**. It owns immutable action metadata and executor registration, but it deliberately exposes no execution method and stores no approval, lease, idempotency or audit state.

The only supported side-effect path is:

```text
untrusted model proposal
→ apps/agent governed application boundary
→ @crm/agent-action-runtime
→ schema validation
→ deterministic business validation
→ trusted tenant/actor context
→ permission and object authorization
→ policy evaluation
→ payload-bound approval when required
→ durable idempotency receipt
→ bounded executor
→ output validation
→ redacted audit event
```

This separation prevents a registry consumer from bypassing policy by calling a convenient parallel `registry.execute(...)` API.

## Catalog contract

Every registered action must define:

- a stable action ID and manifest version;
- explicit permissions;
- `LOW`, `MEDIUM`, `HIGH` or `CRITICAL` risk;
- whether it mutates state;
- `NONE`, `KEYED` or `INHERENT` idempotency semantics;
- bounded timeout and retry policy;
- runtime input and output validators;
- an executor;
- an optional deterministic business validator.

Mutating actions cannot declare `NONE` idempotency. Multiple attempts for a mutating action require an explicit `retrySafe: true` declaration and provider-level idempotency support.

The catalog defensively snapshots JSON schemas, metadata, permissions and retry configuration. Unsafe object keys, cyclic metadata, non-finite numbers, duplicate action IDs and legacy execution-state options are rejected during registration.

## Governed runtime contract

The runtime receives tenant and actor data only from a trusted application boundary. A model proposal may contain only:

```json
{
  "actionId": "crm.deal.update",
  "input": {}
}
```

It may not supply tenant identifiers, permissions, approval state, retry policy, idempotency policy, executor options or a durable-state handle.

The executor receives a bounded contract containing validated input, immutable trusted context, an `AbortSignal`, attempt number, provider idempotency key and operation digest. The operation digest includes tenant, action ID, manifest version and canonical validated input.

## Durable state

Production composition uses:

- `GovernedActionReceipt` for lease-based exclusion, result replay and ambiguous-outcome quarantine;
- `GovernedActionApproval` for single-use tenant/action/payload-bound approval consumption;
- `GovernedActionAuditEvent` for redacted execution evidence.

In-memory stores exist only for deterministic unit tests. They are not a production persistence mechanism.

## Failure semantics

- Validation, authorization and policy failures occur before an executor side effect.
- A pre-aborted request does not acquire a receipt or consume an approval.
- A successful receipt remains authoritative if success-audit persistence subsequently fails.
- A non-retry-safe mutation that times out after execution starts is marked `AMBIGUOUS`; it is not blindly retried.
- An active matching receipt returns `ACTION_IN_PROGRESS`.
- Reusing an idempotency key for another payload is rejected.
- A completed matching receipt replays the stored validated result without invoking the executor.

## Agent-run integration

The legacy `AGENT_ACTION_EXECUTORS` dispatch path has been removed. Agent-facing CRM activity and Slack tools now enter through `apps/agent/agent/lib/governed-run-actions.ts`, which composes the catalog, trusted run context, policy and durable governed stores.

The generic `GovernedActionReceipt` and the existing user-visible `AgentAction` record are intentionally separate ledgers:

- the governed receipt owns security-sensitive idempotency, operation digest, execution lease, replay and ambiguity quarantine;
- `AgentAction` owns run-visible business status, target, provider receipt and remediation information.

Only the governed bridge may call the low-level run side effects. The strict boundary audit now has zero migration findings and treats any new direct caller or reintroduction of `AGENT_ACTION_EXECUTORS` as release-blocking.

See `docs/architecture/agent-run-action-execution.md` and ADR 0009 for the full execution and rollback model.
