# Governed agent-run action execution

## Scope

This boundary executes the two external side-effect capabilities currently exposed to the agent runner:

- `crm.activity.create`;
- `slack.message.post`.

`run.summary` remains run-control state and is not registered as an external governed action.

## End-to-end path

```text
Eve tool input
→ create_crm_activity / post_slack_message
→ governed-run-actions.ts
→ governed-run-action-runtime.mjs
→ catalog input and business validation
→ trusted AgentRun context
→ manifest/action/data-scope authorization
→ policy evaluation
→ durable GovernedActionReceipt
→ low-level run side effect
→ output validation
→ redacted GovernedActionAuditEvent
```

No agent tool imports the low-level side-effect functions. `executeRunActivitySideEffect` and `executeRunSlackMessageSideEffect` are callable only from `governed-run-actions.ts`; the repository boundary audit fails on any other production caller.

## Trust boundary

The model may provide only business input. It cannot provide:

- tenant or workspace ownership;
- actor, permissions or correlation identifiers;
- approval state;
- retry policy;
- operation digest;
- executor options;
- receipt or lease state.

The application loads the active `AgentRun`, parses its immutable deployed manifest and derives:

- `tenantId` from the server-owned workspace configuration;
- `actorId` from the run ID;
- `requestId` from the run and tool-call IDs;
- `correlationId` from the persisted run;
- permissions from the exact manifest-declared action.

Authorization and policy evaluation reload the run and verify the complete trusted context. The side-effect layer validates the governed envelope again and rechecks run state and manifest scope before mutation.

## Input safety

Public run/action identifiers are bounded and restricted to an unambiguous identifier alphabet before the legacy-compatible `runId:callId` idempotency key is derived. Request and business-input objects must contain only enumerable own data properties. Accessors, symbols, class instances, unsafe property names and unsupported control fields are rejected before any getter or executor is invoked.

## Two durable ledgers

Two records intentionally coexist:

1. `GovernedActionReceipt` is the security and execution-control ledger. It owns tenant-bound idempotency, operation digest, lease exclusion, result replay and ambiguous-outcome quarantine.
2. `AgentAction` is the run/business ledger shown to users. It records the approved business action, destination, status, provider receipt and remediation information.

They are not competing execution engines. The governed receipt must be acquired before the low-level side effect can claim or update `AgentAction`.

## Failure semantics

- Validation, authorization, policy and pre-cancellation failures occur before a side effect.
- Matching completed receipts replay the validated stored result.
- Reusing one run/call identity with different input is rejected.
- Non-retry-safe timeout after execution begins becomes `AMBIGUOUS`, not an automatic retry.
- CRM activity creation and its `AgentAction` success transition occur in one database transaction.
- Slack uses a stable client message ID and stores the provider receipt.
- If business execution fails, the run-action failure state is persisted. A changed/lost claim is itself surfaced; it never silently masks the original failure.
- If success commits but success-audit persistence fails, the durable receipt remains the recovery source of truth.

## Remaining external gates

The deterministic boundary is covered without external services. The following remain environment-specific release gates:

- generated Prisma client and isolated PostgreSQL migration verification;
- real concurrent workers against PostgreSQL;
- staging AgentRun/tool execution with authenticated tenant data;
- live Slack delivery and ambiguous-outcome reconciliation;
- full Bun-backed semantic typecheck, workspace tests and production build.
