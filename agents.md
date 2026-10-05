# Agent Platform Operating Manual

## Purpose

The agent platform executes controlled business work across CRM and connected systems. It is not an unrestricted chatbot. Reliability is based on deterministic orchestration around an untrusted probabilistic model.

## Runtime model

`Trigger → immutable agent version → scoped context → plan → policy evaluation → validated tools → effects → verification → audit/outcome`.

### Required records

- Definition: stable identity, owner, department and goal.
- Version: immutable instructions, model configuration, tool manifest and policies.
- Run: trigger, correlation identifiers, timestamps, status and cost.
- Event: ordered operational trace without secrets or excessive PII.
- Action: canonical payload, permission, approval state, idempotency key and effect result.
- Audit event: actor, policy decision, before/after metadata and evidence reference.


## Governed side-effect entrypoint

Model-facing tools never call CRM, Slack or another provider side effect directly. The required path is:

`tool → application bridge → catalog validation → trusted context → authorization/policy → durable receipt → bounded executor → output validation → audit`.

`@crm/action-registry` is metadata-only and must not expose an execution API. Low-level provider functions may be referenced only by their application bridge. The strict repository audit blocks legacy executor maps and direct side-effect calls. `run.summary` is run-control state; all independent internal writes and external communications use governed execution.

## Permission tiers

1. `READ`: tenant-scoped data access.
2. `DRAFT`: prepares an artifact without external side effects.
3. `INTERNAL_WRITE`: creates tasks/notes/internal notifications.
4. `EXTERNAL_COMMUNICATION`: sends customer/vendor messages; normally approval-gated until explicitly trusted.
5. `BUSINESS_STATE_CHANGE`: changes deal stage, owner, amount, order or document state; policy/approval required.
6. `IRREVERSIBLE`: delete, payment, privilege grant or bulk export; denied by default and never inferred from natural language alone.

## Approval requirements

Approval must reference an immutable action payload hash. Editing the payload invalidates approval. The approver must be authorized for the underlying resource and action. Approval expiry and replay prevention are mandatory.

## Failure semantics

- Model invalid output: reject, record validation result and retry only within bounded policy.
- Provider timeout/rate limit: bounded retry with jitter or fallback provider/model.
- Tool transient failure: retry only when operation is idempotent.
- Tool permanent failure: terminal action failure with human-readable remediation.
- Partial workflow failure: resume from persisted checkpoint or perform explicit compensation.
- Policy denial: no side effect; record non-sensitive reason.
- Cost budget exceeded: pause before the next paid step and alert owner.

## Production agent catalogue

| Agent | Outcome | Default autonomy |
|---|---|---|
| Lead Intake | Valid lead classified and assigned within SLA | Internal writes automatic; customer send governed |
| Follow-up | Promised next action captured and not missed | Task creation automatic; send approval configurable |
| Deal Risk | At-risk deals identified with evidence | Read/recommend automatic |
| Meeting | Brief, summary and next steps created | Draft/internal writes automatic |
| CRM Hygiene | Duplicates/stale/incomplete records detected | Detect automatic; merge/update approval-gated |
| Executive Brief | Verified business briefing delivered | Internal delivery automatic |
| Reporting | Deterministic metrics explained with source links | Automatic if metric contract passes |
| Collections | Overdue receivables monitored | External reminders approval-gated by policy |
| Document | Approved templates populated | Draft automatic; signature/send gated |
| Approval | Pending business approvals routed/escalated | Routing automatic |
| Support Triage | Request classified and assigned | Internal writes automatic |
| Admin | Internal service requests processed | Access grants always explicit approval |

## Agent release gate

Before deploy: owner, success metric, representative eval set, negative/prompt-injection cases, tool scopes, data scope, approval policy, idempotency design, timeout/retry, budget, incident alert, kill switch, rollback/version pin and user-facing explanation.
