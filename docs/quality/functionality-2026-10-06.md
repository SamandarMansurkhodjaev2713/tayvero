# Authenticated functionality review — 2026-10-06

Current local acceptance covers genuine BetterAuth sessions, the production `createApp()` entry point, real PostgreSQL, optional onboarding and a complete core CRM journey. It does not establish whole-product production readiness. Machine-readable results and sanitized logs are in `functionality-2026-10-06/acceptance.json`.

## Actual results

- Published baseline: commit `42070b09770ca47c59e668d5248af291cac7bc76`, GitHub Actions run **37457016098**, successful. That source passed 584 Node tests and 1437 Bun tests. It does not accept the changes from this review; fresh Linux CI is required.
- Focused final tests: **15 passed / 0 failed / 0 skipped**, 60 assertions. Twelve HTTP/service/fixture scenarios and three website-contract scenarios. Command, from `apps/api`: `bun test --preload ./test/setup.ts test/workspace-website.spec.ts test/authenticated-workspace.e2e.spec.ts`.
- Pipeline PostgreSQL gate: **3 passed / 0 failed / 0 skipped** on a fresh dedicated database. Exact rollback error/cause and unchanged database state remain asserted.
- Full API Windows run, before the final fixture-cleanup hardening: **570 tests / 511 passed / 59 failed / 0 skipped**, 26.08 seconds. All failures were `SOURCE_STORE_CONFIG`: 58 migration-application cases and one operations PostgreSQL setup failure. The new authenticated suite passed in this shared-suite run. Final cleanup hardening is covered by the final focused run.
- API semantic typecheck passed; all eight owned source/test files passed Biome without warnings or errors. No production authorization, mailbox guard, timeout, deployment flag or POSIX filesystem requirement was relaxed.

## Integration environment and boundaries

A unique disposable `postgres:16` container was bound to `127.0.0.1:54361`. Inspection confirmed zero persistent mounts and a tmpfs PostgreSQL data directory. Each gate used a separate explicitly selected `_test` database, distinct from the bootstrap database; all 66 migrations deployed without reset. No customer database or provider credentials were used. The container is stopped after this review and its tmpfs data is discarded.

The signed-session helper refuses non-test execution and uses the existing explicit test-database resolver. It persists actual users, memberships and sessions, signs cookies through the application's real BetterAuth context, and keeps cookies in memory. There are no mocked principals or authorization middleware overrides. Owner/admin/member capabilities, revocation while a session remains valid, tampering, expiry and absence are checked through HTTP.

The business journey creates a company, contact and deal; reads back relationships; records a note and task; checks `myTasks` isolation by actor; completes and reopens the task; archives/restores all three records; and checks search visibility. Invalid relations, empty tasks, completing a note, missing records and anonymous writes are denied. Read-only agent inventory and operations responses preserve their explicit unverified-provider and unimplemented-outcome-ledger indicators; revoked actors are denied.

Provider enrichment, favicon/backfill and dispatch boundaries use test-only spies. The supported no-agent-bridge configuration prevents bootstrap transport; real database transactions and durable CRM event queue writes remain exercised. No model, OAuth login, email/Slack send, browser session transport or native agent run is claimed. Existing operations PostgreSQL acceptance uses fake execution transport and does not prove live-agent execution.

## Critical verification and refinement outcomes

| Review lens | Finding and resulting verification |
| --- | --- |
| Contract semantics | Required website previously blocked optional onboarding. Omission now preserves the stored value, blank clears it, and nonempty invalid input is rejected before persistence. Research triggers only for a changed nonempty normalized domain. |
| Fresh authority | Real signed sessions are accepted; removing a membership immediately denies workspace, agents and operations requests while the identity session remains valid. Member settings mutations remain forbidden. |
| Business state | Relationship readbacks, task ownership, completion/reopening, archive/search/restore and denied-write counts are checked against real PostgreSQL rather than rendered fixtures. |
| Asynchronous rejection | Two unchanged pipeline attempts yielded 1 pass/2 failures: transaction acquisition timeout in the rollback assertion, then its dependent concurrency case. Direct awaiting followed by the exact error/cause and rollback assertions yielded 3/3. An existing agent retry assertion similarly timed out/stalled; direct awaiting now checks the exact conflict plus unchanged run/action/audit counts and absent retry receipt. No upstream Bun-causality claim is made. |
| Fixture isolation | Fixtures use unique users and owned records, restore singleton workspace settings and environment, and collect cleanup errors instead of abandoning cleanup after app closure fails. Teardown writes require successful explicit test-database validation; workspace restoration requires a completed snapshot read and deletion requires creation by this suite. Fault injection after membership persistence proves partial creation is cleaned. Final focused execution leaves no owned user or journey company. A simulated app-closure failure is not separately executed. |
| Platform honesty | Windows source-store failures retain the POSIX/O_NOFOLLOW guard and remain red. Successful prior Linux acceptance and pending fresh-source Linux acceptance are recorded separately. No skip-only green result was introduced. |
| Evidence quality | Early absent-test-URL and wrong root-cwd decorator runs were harness/setup failures. Initial HTTP journey assertions expected 201 while the actual REST bridge returns 200; only those assertions changed. The incomplete stalled run has no invented aggregate. Successful scopes, failed scopes and provider/staging limitations remain separate. |

Sanitized evidence preserves the initial pipeline failure, the initial journey harness failure, the stalled API attempt, the final pipeline result, the complete Windows API result and the final focused result. All persisted database URLs are redacted. Fresh Linux CI, authenticated browser testing, real provider/native execution and staging remain separate acceptance scopes.
