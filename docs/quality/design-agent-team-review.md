# Team agents design review

Date: 2026-10-05, Asia/Tashkent. Scope: `apps/app/components/agent-builder/team-agents-index.tsx` only.

## Five critique and improvement passes

1. **Consistency and hierarchy.** Four unrelated summary cards and an ungrouped table became the parent's shared WorkspaceMetrics, WorkspaceMetric and WorkspacePanel system. Existing counts are preserved. The team directory groups the real operational review task; no ROI/savings metrics were added.
2. **Evidence and semantics.** Preserved `summarizeTeamAgents`, `filterTeamAgents`, `displayRunCost`, initial query data and URL filter state. Archived agents remain excluded from the current/review views exactly as before. Latest failed results use danger, pending approval uses warning, succeeded uses success; unknown/null runs remain unavailable/not-run rather than success or zero cost.
3. **Search and recovery.** Replaced the native select with shared Radix Select and shared InputGroup search. Added Carbon icons, explicit useId/label association, live result count and a reset-to-default action. Original empty-state clear-to-all behavior remains intact. Failed refresh keeps the previous snapshot and a recovery message; incomplete API coverage has a warning notice.
4. **Responsive reading and identity.** Shared Avatar initials distinguish agent rows without external images. Names and descriptions wrap, and the filter trigger is bounded by its container. A named, focusable outer section owns horizontal table scroll; nested Table overflow is disabled through its existing layout prop. Column headers/caption and actual table semantics are retained.
5. **Code and accessibility review.** Formatted and checked the owned file with the installed Biome. Fixed label association and used a semantic section. A narrow range suppression covers exactly the keyboard-scroll section's intentional tabIndex, not other accessibility checks. The required Impeccable detector returned an empty finding list. Existing six model tests passed with no modified expectations.

## Executed checks

- `node_modules/.bin/biome.exe check --write apps/app/components/agent-builder/team-agents-index.tsx` — passed after accessibility repairs.
- `node --test apps/app/test/team-agents-model.test.mjs` — 6 passed; failed/skipped/cancelled 0.
- `impeccable.cmd detect --json apps/app/components/agent-builder/team-agents-index.tsx` — returned `[]`.

No new API, model, mutation, total, filter rule or claimed automation capability was introduced. This file's final full application type/build and desktop/mobile rendered interaction evidence are coordinated by the parent fixture, not claimed by this document.

Impeccable context loaded for the exact target and permitted narrow refinement against the existing design. Shared controls own styling; local classes primarily handle row/toolbar flow, wrapping, alignment and accessible scroll/focus. The scroll-region rule exception is intentional because keyboard users must be able to focus and horizontally scroll the wide table; the rule's general recommendation is documented at https://biomejs.dev/linter/rules/no-noninteractive-tabindex/javascript/.
