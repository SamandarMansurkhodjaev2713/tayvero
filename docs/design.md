# Tayvero UI contracts

This is the implementation guide for the system summarized in [DESIGN.md](../DESIGN.md). It describes current source, not an assertion of complete accessibility, localization or production readiness.

## Ownership and themes

`packages/ui` owns reusable controls, operating surfaces and visual tokens. Import shared components through `@crm/ui/components/*`; add recurring variants there. Page `className` may compose layout, width and responsive placement, but should not establish a competing button, input, status or panel style.

The authoritative palette definitions are [`appearance.mjs`](../packages/ui/src/theme/appearance.mjs). Its generated block at the end of [`globals.css`](../packages/ui/src/styles/globals.css) overrides the older fallback declarations above it. Change the definitions and run `node tools/quality/generate-appearance.mjs`; verify with `--check`. Do not edit generated values or copy the initial green fallback into a new screen.

| Palette | Character | Light primary / background | Dark primary / background |
| --- | --- | --- | --- |
| Graphite | Clear neutrals, blue accent; default | `#2557a7` / `#f6f7f9` | `#99bbff` / `#11161e` |
| Grove | Quiet green | `#246348` / `#f5f8f6` | `#99d1ac` / `#111b17` |
| Sand | Warm surfaces, clay accent | `#955132` / `#faf7f2` | `#e8b58d` / `#1c1814` |
| Indigo | Cool ink, violet accent | `#6550a5` / `#f7f7fc` | `#c1b0f5` / `#181621` |

Consume `background`, `card`, `foreground`, `muted`, `muted-foreground`, `border`, `input`, `primary`, `primary-foreground`, `ring` and `sidebar-*` by semantic role. Both the primary fill and its foreground change with mode; `ring` follows the current primary. Success, warning, destructive, info and severity roles retain their meaning across all four palettes, with separate light/dark values. Accent color is not a substitute for outcome semantics. Chart series use chart tokens and accompanying labels.

Appearance choices are palette, comfortable/compact table density and expanded/compact navigation. Theme mode is managed separately by `next-themes` (system/light/dark). The pre-paint bootstrap and provider normalize stored choices to allowlisted values; storage failures do not prevent rendering. Persistence still needs verification on the real deployment origin.

## Operating surfaces

Use [`workspace.tsx`](../packages/ui/src/components/workspace.tsx), styled once in shared `globals.css`, for recurring operational composition:

| Component | Contract |
| --- | --- |
| `WorkspaceMetrics` + `WorkspaceMetric` | One definition-list band with label, tabular value and optional detail. Default four columns; two/three metrics adapt to their count. `tone="warning"` signals an actual concern. |
| `WorkspacePanel` | Section with an `h2`, optional explanation/action and body. Header wraps; body and section permit shrinking. Shared border, card background and 8px corners. Overlays inside its clipped surface must use shared portal components. |
| `WorkspaceNotice` | Informational context or explicit warning/danger. Wrapping text, subdued semantic fill and border. It supplies presentation; choose appropriate status/alert/live-region semantics at the call site. |
| `WorkspaceStatus` | Text label with a small dot and neutral/success/warning/danger tone. Keep the label meaningful; color alone cannot explain a result. A forced-colors border remains visible. |
| `WorkspaceToolbar` | Wrapping flex row with a 12px gap. Width and order belong to the page; styling belongs to the shared component. |

Pending, successful, failed and unknown results must remain distinct. Permission, delivery, execution and reconciliation are different events. Missing data must not become a zero metric or a successful state. Display feature availability and coverage limits beside the relevant action, including existing default-OFF approval/continuation/background execution guards. Styling never authorizes an action or changes those guards.

## Type, controls and spacing

Geist is the UI family and Geist Mono the code/identifier family, loaded in `apps/app/app/layout.tsx`; headings share the sans family. The operating page title is 26–34px, weight 600, line height 1.2. Panel headings are 15px/600, panel explanations and metric labels 13px, supporting details/status labels 12px. Metric values are 24–32px/600 with tabular numerals and wrapping. Longer page descriptions stay within 72ch; panel explanations within 65ch.

`Button` owns default, outline, outline-ghost, secondary, ghost, destructive, contrast and link variants. Default buttons are 36px tall with 13px text and 12px horizontal padding; use the shared size API. `wrap` enables multiline labels with automatic height and a 36px minimum. `Input` uses a 36px height, 14px text, a card surface and input/ring tokens. Disabled and invalid states remain component-owned.

Use the existing 4px spacing rhythm and shared 8/12/16/24px gaps. Small controls use 4px corners, standard controls 5px, operating panels/overlays 8px; the token scale also defines 12px. Edge-joining elements may use square corners. New recurring visual variants belong in `packages/ui`, including changes to radius or padding; avoid literal per-page replacements. Existing appearance swatches have local illustration geometry, which is not a new control scale.

Focus remains visible using the selected ring token. Shared buttons/fields provide state rings; global keyboard focus adds a 2px outline with a 3px offset. State transitions are restrained, table hover transitions last 120ms, and reduced-motion preferences suppress animation/transition durations.

## Shell and responsive composition

[`PageShell`](../apps/app/components/page-shell.tsx) owns a scrollable main, centered maximum 1280px content and 24px section gaps. Shared CSS supplies fluid 16–40px inline gutters, 30px vertical padding and a divided heading region. Header actions move under the description on small screens and wrap. Use its loading/fallback states instead of presenting unloaded content as empty results.

The application header is 64px high, reducing to 58px at 700px. It identifies Tayvero and the workspace; global search retains an accessible name when its text/shortcut are hidden. Navigation expands to a labeled 208px rail at 1100px unless compact mode is chosen. Smaller screens preserve icon labels for assistive technology, tooltips, current-page state and the shared mobile Sheet. Retain the skip link and its focusable workspace target.

At 700px and below, metric bands use two columns; the third of three metrics spans the row. Metric/panel padding becomes 18px by 16px. Buttons have a 40px minimum height; inputs, textareas and select triggers also use at least 40px and 16px form text. These are shared rules, not page overrides.

Search must remain a usable field when toolbars wrap. The team-agents precedent (`apps/app/components/agent-builder/team-agents-index.tsx`) gives search a full-width mobile row with a 12rem minimum and allows desktop flex growth. Keep its label, query state, filters and clear/recovery controls. Use named focusable horizontal scroll regions for wide evidence tables; wrap imported long values inside bounded cells rather than relying on a native tooltip.

Comfortable tables use 13px text, 12px vertical cell padding and 40px headers; compact tables use 12px, 7px and 34px respectively. Density changes scan rhythm without changing status meaning or hiding data.

## Public landing exception

[`landing.css`](../apps/app/components/landing/landing.css) is a scoped `.tayvero-landing*` editorial marketing surface. It deliberately uses larger typography, longer section rhythm and asymmetric composition; do not import those rules into operating screens. Its maximum width is 1280px, its hero headline 48–88px (43–64px on small screens), and its major sections stack at 700px. It shares semantic colors, Geist, shared `Button` variants with `wrap`, focus tokens and reduced-motion support. Native FAQ disclosure remains keyboard usable.

Product imagery is labeled as a component preview with synthetic data. Keep setup/source access, deployment limitations and factual readiness copy. The project is an open-source CRM and Business OS foundation in active development, currently deployed separately per workspace. RU/UZ/EN operational catalogs exist, but localization is partial. Do not add SaaS tenancy claims, production guarantees, invented customer proof, delivery success or unimplemented integrations.

## Verification boundary

The workspace light/dark images and [finish review](quality/design-finish-review.md) support the observed hierarchy and shared surface consistency. They do not certify all eight appearance combinations, authenticated workflows, assistive-technology output, provider behavior or database execution. For future changes verify affected light/dark palettes, narrow widths, long localized text, focus and recovery states; preserve existing default-OFF execution flags and semantic-token contracts.
