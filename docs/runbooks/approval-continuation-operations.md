# Approval continuation — deployment and acceptance
Updated 2026-09-15. Disabled by default; local verification is NOT production authorization.

## Prerequisites
1. Restore an isolated PostgreSQL database and supply TEST_DATABASE_URL explicitly. Never production.
2. Install the locked Bun/workspace dependencies. Run Prisma generation and semantic types/build.
3. Apply the expand-only 20260915100000_approval_continuation migration as part of all pending migrations.
4. Run `bun run gate:pipeline-postgres`, `bun run gate:operations-postgres`, `bun run quality:gate`.
5. Start the actual locked Eve, API and Next in isolated staging. Configure the same dedicated workspace,
   secret-manager bridge key (minimum 32 bytes), bound approvals, fixed AGENT_URL and active dispatch schedule.
   No customer credentials or destinations. Set policies on only fixture CRM records/test Slack destination.
6. Only in staging, set AGENT_APPROVAL_CENTER_ENABLED=1 and AGENT_APPROVAL_CONTINUATION_ENABLED=1 on API and
   agent processes. Example policy: AGENT_ACTION_POLICIES_JSON={"slack.message.post":"REQUIRE_APPROVAL"}.
   Verify policy contract syntax in governed-action-policy.mjs/createActionPolicy before rollout.

Turbo development forwards the actual flags and migration store variables. Production startup must receive
its own env/secret configuration. Do not embed server secrets in browser/public variables or commit them.

## Native acceptance matrix — NOT RUN HERE
Create fresh fixture runs through the normal app, never by inventing native sessions in the database.
- Tool preflight produces the same normalized digest as execution, with no message/activity yet.
- input.requested has the original child session/call and stable event ID; parent forwarding cannot rebind.
- session.waiting persists WAITING_FOR_APPROVAL, without overwriting startedAt.
- A different current owner/admin approves. Original human/scheduled principal is preserved on HTTP resume.
- The dispatcher POSTs only to the saved child ID, with its exact requestId. Native response proves same ID.
- Exactly one governed receipt, consent consumption and business effect. Parent workflow continues normally.
- Two dispatchers, repeated events, simultaneous tool requests, separate child sessions: no duplicate claim.
- Reject, expire, cancel, revoked reviewer/requester, changed agent version/scope: no unauthorized effect.
- Kill before/after HTTP acceptance and before/after receipt commit. An unknown ACK is quarantined, not retried.
- A successful receipt may close the ticket after ACK loss; absence of receipt does not prove no side effect.
- Resume after process restart and after human delay exceeding the normal execution timeout. startedAt stays
  historical; current deadline prevents a stale timeout-worker result from failing a resumed/waiting run.
- Expired JWT, reused lease, changed route/body/call/session, forged inputResponses and stale native request
  are rejected. Verify actual Eve auth chain does not fall back to development access in deployment.
- Check fresh upgraded sessions; older stream events lacking meta.id are not resumable by this adapter.

Use at least two admins plus member/revoked fixtures. Capture DB receipt/audit rows and actual native events
with sensitive payloads removed. Test real browser paths and all themes at 390/768/1440 px. No automated
Eve E2E harness was executed or represented as passed by the local gate.

## Operations UI
`/<slug>/operations` -> Continuations. ACTIVE, ATTENTION, ALL; 50 per page; updates only while active.
PREPARED / BOUND: native lifecycle not parked yet. READY: waiting for a valid human result.
DISPATCHING: a persisted lease exists. DELIVERED: native transport acknowledged; not business completion.
COMPLETED: matching successful governed receipt. RECONCILIATION_REQUIRED: inspect before any intervention.
Lease/JWT/raw action payload are not returned by the list API. No unsafe Retry Whole Run button.

## Quarantine procedure
Stop further attempts for the affected run. Match workspace/run/call/payload digest, native request/session,
HTTP audit and provider/business evidence. A transport error does not prove absence of execution.
If a SUCCEEDED receipt already exists, the normal bounded receipt sweeper can mark COMPLETED without delivery.
Otherwise preserve the evidence and use a separately reviewed reconciliation fix; there is deliberately no
public operation that fabricates success, resets consumed approval or changes idempotency keys. A full guided
operator reconciliation workflow and terminal-ticket retention are not implemented in this checkpoint.

## Disabling
Set AGENT_APPROVAL_CONTINUATION_ENABLED=0 on API/agent to stop new native handling/dispatch. Disable affected
agent triggers during investigation. Keep all history and schema; no DROP or blanket run replay. Rollback is
not an instruction to ignore a pending approval or to enable direct executor paths.
