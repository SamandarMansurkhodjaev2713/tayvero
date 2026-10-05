# Shared design review — 2026-10-05

Eight concrete critique / improvement rounds in the parent lane:

1. Navigation lacked a direct Operations entry and Chat shared an indistinct symbol. Added meaningful groups, explicit labels and distinct Carbon icons; kept all destinations and compact accessible names.
2. Operating screens had inconsistent headline/control/panel rhythm. Established shared workspace components and shell sizing, using existing semantic palettes rather than page-specific colors.
3. Dashboard summary could remain a spinner after first error. Added actionable retry and a separate warning for stale data; retained previously loaded snapshot.
4. Long translated buttons broke compact layouts. Added opt-in wrap compound styling after size variants so Tailwind merge cannot cancel multiline height; existing buttons keep their behavior.
5. Metric borders selected the wrong children and three-count bands wasted a column. Corrected actual cell selectors and coherent responsive two/three/four layouts.
6. Type confidence was only syntactic. Installed locked toolchain, generated real clients and ran semantic checks; owners fixed real nullable contracts, and Next found/fixed missing Suspense boundaries without disabling auth or checks.
7. Public presentation inherited fabricated stars, ownership links and upstream analytics. Rebuilt truthful landing/README around real component artwork; configured owner-key-only telemetry and default-off browser analytics.
8. Independent finish review found touch-inaccessible long CSV cells and mobile agent search compressed to an icon. Both repaired narrowly, with final320px search248px and no document overflow. No further P0/P1 was found in the reviewed scope.

Explicit shared UI formatting used Biome stdin for five source files because the incumbent configuration excludes packages/ui/src/components. Token generated-contract check and workspace lock audit passed. Browser theme evidence covers all8appearances at768px. Full semantic and Next logs are separate from the fixtures; no production readiness or perfect-design guarantee is claimed.

## Keyboard focus follow-up

A final native-keyboard check exposed focus loss when the externally opened command dialog closed. Source confirmed QuickSwitcher controls CommandDialog through URL state without a DialogTrigger. Five checks refined the fix: capture the active opener before default autofocus; retain ordinary dialog initial focus; restore only a still-connected element; leave default close behavior available when no valid opener exists; mount the actual shared CommandDialog and verify Header Enter → Escape returns focus to the named search button. This check used synthetic fixtures, not authenticated search queries. No search/record/action contracts changed.
