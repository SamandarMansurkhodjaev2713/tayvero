# Team tasks independent review

Phase: final bounded source review. Rechecked the current backend, migration, agent executor and UI source on 2026-10-06 after the implementation fixes. This review does not certify production readiness.

## Scope and five review lenses

1. Authorization and membership: task author, assignee and workspace owner/admin can edit; only author or owner/admin can reassign. Mutations recheck current deployment membership and lock membership rows. Read access remains shared within the documented single-dataset deployment. Immutable authorship is distinct from assignment.
2. Atomicity, history and concurrency: row locks serialize task mutations; editor updates require the observed version; completion repeats retain the original timestamp. History records actor names and before/after state in the mutation transaction. Agent creation uses the run lock, an empty upsert update and an initial event only for a newly created activity.
3. Deadlines, pagination and data honesty: human API deadlines require an ISO instant with an offset. The editor preserves the original seconds/instant for an unchanged displayed minute, rejects nonexistent local times, and explains repeated-hour behavior. Queue totals and page-group counts are distinct; deterministic page ordering includes ID. Page-based navigation is a fresh snapshot rather than a frozen cross-page dataset.
4. Error recovery, accessibility and UX: stale queue data is identified and mutations disabled; initial errors do not invent zero totals. Editor conflicts preserve unsaved inputs and require explicit reload. Forms have labels, feedback uses alert/status roles, and history states its 50-event bound. Browser behavior, focus restoration, visual layout and device interaction have not been verified by this source review.
5. Governance, evidence and cleanup: agent assignment derives from trusted run identity and active membership, not model input. The model allowlist, manifest scope, policy, receipt and approval payload remain bounded. Integration fixtures guard the test database and use unique actors/resources; cleanup attempts subsequent operations even if one operation fails.

## Findings resolved and rechecked

- Resolved P2: activity stamping formerly ran after the activity/history commit. The final source awaits `stamp.touch(..., tx)` inside the create transaction; the stamp service uses that client for each update. The signed HTTP suite injects a real database stamp failure and verifies unchanged task and audit counts.
- Resolved P2: creation formerly accepted contradictory company/contact/deal anchors. The final source resolves and validates each supplied relationship inside the create transaction before writes. The signed HTTP suite rejects contradictory links and accepts matching links. This was data-integrity contamination within one deployment, not a cross-tenant claim.

No additional confirmed P1/P2 finding remained in the bounded final source scan. Agent membership now uses `FOR SHARE`; initial history stores the assignee name snapshot. The composer now accepts an exact local date and time using the same validated deadline helper as the editor. The assignee picker retains the selected name across searches.

## Meaningful acceptance scenarios

- Author A assigns to B: creator remains A, B's assigned queue receives the task, and team queue lists it once. Legacy migration assigns only active authors and leaves departed authors' tasks unassigned.
- Nonmember, foreign-organization and revoked assignee/actor attempts fail without task or history writes. An unrelated active member cannot edit or complete a guessed task ID.
- Same-version competing edits produce one successful change and one conflict. Repeat completion preserves timestamp/version/history. Reopen then completion records each actor and state transition.
- Audit or stamp failure rolls back the create/mutation. Contradictory record anchors fail before task, audit or stamp writes.
- Omission preserves assignee/deadline; explicit null clears them. Offset-free or malformed deadlines fail. Local midnight, DST gaps, repeated hours and unchanged-second preservation are checked.
- More than one page of equal deadlines has stable ordering, exact filter totals and accessible undated rows. Empty pages after mutations offer recovery.
- Agent retry creates exactly one task and initial event, preserves later human assignment, and rejects model-supplied assignment fields before effects. The interrupted persistence path should be tested separately from the successful-receipt replay fast path.

## Verification limits

No product-source edits were made by this reviewer. No browser preview or alternate browser/host/port/CDP attempt was made after the existing browser-security rejection. This reviewer inspected source/contracts and test assertions, and ran `git diff --check` successfully; they did not independently rerun database or UI suites.

The backend owner/parent reported 24/24 signed HTTP tests with 106 assertions, a real SQL migration check with 1/1 test and four assertions, and an empty schema-drift comparison. These are attributed implementation-owner results, not independent reviewer executions. UI/browser pixels, actual keyboard focus, live providers, cross-page consistency during concurrent insertions and the interrupted agent persistence/retry path remain outside this review's proof. Broad verification results and release/push decisions belong to the coordinating parent.

The UI owner confirmed the reviewed source was stable with no pending writes, and reported final focused Bun 33/33 (including 18 queue/editor SSR tests), Node 15/15, app TypeScript and Biome checks passing, plus the repository audit passing. Their evidence includes the consumed creation-field payload, recorded-name/legacy-history fallbacks, permissions, stale state, version notice and responsible-person filter. These results also remain attributed to the implementation owner.

Final four-file filter recheck: picker maps omitted/undefined to all responsible people, null to unassigned, and a user ID to that member. The queue wrapper sends the filter only for Team, resets page/editor/feedback on changes, and blocks changes while stale, fetching or pending. Mine hides the filter; counts copy explicitly identifies the selected responsibility scope. The accompanying SSR case asserts the all/unassigned labels, stale disabling, count wording and Mine hiding. No confirmed P1/P2 was introduced by this last delta; `git diff --check` passed again.

The parent additionally reported the properly configured complete app run at 236 passed / 0 failed, 13 uncached type checks and nine uncached lint checks passing. Its Windows Node result was 599 total / 526 passed / 73 exact known failures. These broader results were not independently rerun by this reviewer. An unconfigured app guard failure remains valid fail-closed behavior rather than a claimed passing environment.
