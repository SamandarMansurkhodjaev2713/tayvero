# Agent journey review — 2026-10-06

This refinement uses the existing agent contracts and governed execution model. It does not add permissions, provider capabilities, a dry run, an owner-assignment API or new business actions. The target is a understandable path for a creator, teammate or workspace administrator: **task → private draft → boundaries and activation → real run → agent report and recorded actions → safe recovery**.

## Source audit and resulting changes

| Review lens | Criticism | Result |
| --- | --- | --- |
| 1. Task clarity | New agent previously opened a Slack-first form and an ambiguously named handoff. | The form leads with task and expected result, explains the private planning chat, and moves Slack preferences into an optional disclosure. Existing handoff and permission schema are preserved. |
| 2. Honest integration state | The form promised immediate channel membership and called Slack a connected workspace without confirmation. | It asks the user to review channel access, distinguishes requested Slack actions from workspace policy, and labels the handoff resource as context. The form supports refresh, pagination and stalled/syncing guidance; no missing channel blocks draft preparation. |
| 3. Boundaries before effects | Draft details told users to deploy before changing capabilities. Activation silently enabled triggers. | Draft corrections return to the source conversation. A confirmation reviews task, trigger and data scope and explains that activation enables triggers immediately. The immutable version chosen for review supplies the deployment mutation's version ID. |
| 4. Responsibility and authority | Creator, owner and team visibility were mixed. A generic chat link lost the agent context. | The UI names the creator and management authority using `canManage`. It keeps manual run availability for readable team agents without turning it into a management privilege. Drafts link to their real source conversation; a queued chat-card run links to its exact ID on detail. |
| 5. First-run and active-run states | Queued requests looked like completion; an active run caused a conflict only after clicking. | Detail explains draft readiness, first run, paused state and active/waiting runs. Manual runs are disabled while a known active run exists. A new manual run or retry opens its selected history row. Event-only behavior is preserved. |
| 6. Evidence and uncertainty | History omitted the API's report and cost. A completed receipt could be mistaken for a verified business outcome. | Detail/history identify the report as agent-generated. History separately shows recorded actions, statuses, receipt references, action errors, missing report/cost states and truncation. No independent remote-outcome verification is invented. Failure copy no longer claims that an unsettled/refused run left nothing done or encourages an unconditional provider retry. |
| 7. Safe recovery | Disabled retry depended on a hover tooltip; users could assume it ran their latest edits. | The server's `canRetry` remains fail-closed. Blocked reasons are visible, including possible duplicate effects. Allowed retry explicitly creates a new run using the original immutable version. Cancellation continues to explain that completed effects remain. |
| 8. Usability and accessibility | Form submission, toggle state, resource search and loading/error states lacked adequate semantics. Desktop rows squeezed mobile controls. | Native form submission, required limits, pending locks, inline errors and retained input are added; toggles expose `aria-pressed`, action switches/search have names, pickers separate pending/error/empty, and retry/stop controls stack on narrow widths. Timestamps use the existing `LocalDateTime` component with timezone guidance. |
| 9. Information hierarchy and maintainability | Code competed with the task and boundaries, while new readiness conditions grew a large component. | Deployed files move into an Advanced disclosure with a publication explanation. Drafts do not query/display unavailable deployed file UI. Readiness presentation is extracted into a focused component; Biome's complexity gate passes without suppressions. Capability updates are named “Publish updated version” and preserve prior-run version identity. |

## Files

- `apps/app/components/agent-builder/new-agent-dialog.tsx`
- `apps/app/components/agent-builder/team-agent-detail.tsx`
- `apps/app/components/agent-builder/agent-builder-chat.tsx` (review/deployed cards only)
- `apps/app/components/agent-builder/agent-capabilities.tsx`
- `apps/app/components/agent-builder/agent-history.tsx`
- `apps/app/components/agent-builder/agent-runs-drawer.tsx`
- `apps/app/lib/agent-handoff.ts` (resource-description copy only)
- `apps/app/lib/agent-run-failure.ts` (uncertain-effects/retry copy only)
- `tools/quality/ui-preview/agent-journey-fixtures.mjs`
- `tools/quality/verify-agent-journey.mjs`

Contract evidence: `apps/api/src/agent/agents.contracts.ts`, `agent-access.service.ts`, `agent-definitions.service.ts`, `agent-runs.service.ts`, and `run-retry-policy.mjs`; `packages/validation/src/agents.ts`. These APIs and schemas were inspected, not edited.

## Verification

- `bun tools/quality/verify-agent-journey.mjs` — **39 checks passed**. The script validates synthetic fixtures against the real API output schemas, renders actual `TeamAgentDetail` and `AgentRuns` components, and checks private-draft, ready/incomplete, ordinary-member, paused, event-only, queued, waiting, result, retryable, blocked-retry and empty states. It also runs the real retry policy on attempted-effect/no-effect fixtures. Every mutation rejects. Standalone Next navigation/link/ViewTransition are isolated adapters; this is not production authentication acceptance.
- `bun test apps/api/test/run-retry-policy.test.mjs apps/app/test/team-agents-model.test.mjs` — **13 passed, 0 failed**, including incomplete history, uncertain outcomes, attempted effects, member-visible summaries and unknown versus zero cost.
- `bun run check-types` from `apps/app` — **passed**, real semantic `tsc --noEmit`.
- Targeted Biome checks for the changed source/harness files — **passed** after component extraction; no lint suppressions or weakened rules.

No provider or database business actions were invoked. No new browser screenshots were taken: the local preview browser entry was rejected by browser security, and no alternate hostname, port, browser or protocol was used. Mobile layout and overflow handling were reviewed in source; they still require an actual browser/touch/keyboard acceptance pass. SSR checks establish state/contract presentation, not pixel quality or interactive correctness. Parent-owned full build, repository gates and deployment acceptance remain separate evidence.

## Remaining product decisions

The API exposes creator/initiator and management authority, not a separately assignable business owner. It exposes activation and real runs, not a safe no-effects test. Definition status does not prove worker/provider readiness. Summaries and receipts do not independently prove the final remote business outcome. History is bounded (50 runs, 100 changes, bounded events/actions), and the UI now says so. Builder examples remain prompt seeds rather than certified workflow templates. English workflow copy is retained; complete locale-wide translation and universal catalog/template validation require their own scope.

The coherent model is therefore grounded in existing data: **task** from instructions/draft description; **responsibility** from creator, initiator and real management rights; **boundaries** from version capabilities and triggers; **result** from an agent-generated report accompanied by recorded actions, receipt references and explicit uncertainty. Future owner assignment, provider-readiness checks or verified business outcomes need contracts and backend evidence before the UI can promise them.

## Independent closing review

10. Delivery failure can follow an accepted dispatch and a failed persistence step. Changed DELIVERY_FAILED and DELIVERY_EXHAUSTED copy to uncertain confirmation, with recorded-action review before retry.
11. A deep link outside the bounded history previously showed no explanation. Added an explicit missing-reference notice and a recovery action when an outcome filter hides a loaded reference. Two additional actual SSR checks reject a fabricated report for an unloaded run.
12. Promoted the contract-backed SSR verification into the root test command, after the existing sequential workspace tests. Its 39 assertions remain separate from test-runner totals and do not imply browser interaction or live-provider acceptance.
