# ADR 0015 — Exact-session approval continuation
Date: 2026-09-15
Status: implemented behind a disabled rollout flag; native/Prisma integration NOT accepted.

## Decision
Keep the original AgentRun, immutable version, callId, payload digest and native child session.
An approval decision is consent, not a command to replay the whole run. Neither channel continuation
handles nor fresh sessions may replace the saved child ID. Share input normalization, manifest version,
authorization and policy preflight with the existing governed executor; preflight has no side effect,
receipt acquisition or approval consumption.

Persist PREPARED -> BOUND -> READY -> DISPATCHING -> DELIVERED -> COMPLETED tickets.
Bind BOUND only from the trusted framework input.requested event, including requestId/turnId/sequence.
READY requires the framework session.waiting event. Stable event IDs prevent duplicate parking;
a changed native request identity is committed to RECONCILIATION_REQUIRED, not silently rebound.

One serializable claim per original run; finite dispatch lease, exact one-use route/body-bound HMAC
transport admission, current requester/approver checks. The HTTP call is outside the transaction, once.
Missing/late/wrong-session ACK is RECONCILIATION_REQUIRED, never an automatic HTTP resend. A matching
SUCCEEDED governed receipt can prove completion after lost delivery acknowledgement without resending.
A positive HTTP ACK alone is DELIVERED, NOT business completion. Native errors without a successful
receipt still require operator reconciliation; no arbitrary reset/retry API was added.

## Identity and time
Persist the same principalId that initial dispatch sends to the native root. Version editors are not
necessarily the original scheduled principal. Historical scheduled runs follow original dispatch's
agent creator; conflicting manual/persisted principals fail closed. Membership remains a live check.
Keep startedAt immutable. Suspend only execution budget while waiting. Timeout selection is advisory:
recheck a freshly locked run before FAILED, because it may have parked/resumed since the scan.
One pending delivery per run, bounded polling (20 per batch, pending checks delayed 60 s), max 50 open
requests. Maximum seven-day overall suspended run lifetime; approval TTL remains the existing policy.

## Native integration boundary
Two tools: create_crm_activity and post_slack_message. Hook -> durable ticket -> schedule-dispatch ->
POST /eve/v1/session/<exact-child-id> with structured inputResponses. The separate JWT has a dedicated
issuer/audience, exact route/body binding and 60-second lifetime. It is not a generic CRM user token.
The native execution guard rejects a changed call/digest and blocks new effects while a ticket is
uncertain. The existing executor consumes actual consent and retains its own receipts/idempotency.

## Trade-offs / unverified assumptions
Current public Eve documentation describes this protocol, but the locked 0.29.4 runtime and its types
are NOT installed here. Hook input shape, event IDs, parent/child ordering, auth ownership, response
headers, cancellations and process restart MUST be tested against the locked runtime. No native E2E,
LLM run or provider call was performed. The local HTTP fixture is not Eve. No schema/migration was
applied; serializable-query doubles cannot prove PostgreSQL concurrency/SQL correctness.
Conservative quarantine may require manual recovery even when a message was never delivered. This
availability trade-off avoids silent duplicate external effects. Cleanup of terminal/orphan tickets,
bounded historical retention and full operator reconciliation remain follow-up work.

## Rollout / rollback
AGENT_APPROVAL_CONTINUATION_ENABLED=0 by default. Require AGENT_APPROVAL_CENTER_ENABLED=1 and a
secret-manager AGENT_BRIDGE_SECRET plus fixed AGENT_URL only after DB/toolchain/native acceptance.
Apply the new expand-only migration to disposable DB first. Do not enable for pre-upgrade waiting
sessions without compatible stable event identities. Disable the feature to stop native delivery;
retain tickets, approval/receipt/audit history and the new AgentRun fields. Do not rewrite tickets to
READY or generate fresh idempotency keys to recover an uncertain action.

## Sources reviewed (current public contract, not proof of locked-version behavior)
https://raw.githubusercontent.com/vercel/eve/main/docs/tools/human-in-the-loop.md
https://raw.githubusercontent.com/vercel/eve/main/docs/concepts/sessions-runs-and-streaming.md
