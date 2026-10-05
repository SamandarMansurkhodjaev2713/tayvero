# Tayvero public landing review

Date: 2026-10-05, Asia/Tashkent. Scope: public marketing page, landing components/styles and its copied public screenshot asset.

## Direction and scope

Frontend-design skill applied to the existing Tayvero world: calm editorial typography, generous separation, asymmetric first viewport, flat semantic surfaces and real product proof. Shared Button/Textarea/logo own controls. A scoped `landing.css` owns marketing composition; it does not alter application styles or global theme tokens. No new font download, generated imagery or backend action was added.

The route now delegates to reusable `TayveroLanding`; existing `IS_MARKETING` / authentication gating remains outside this component and unchanged. Russian is declared on the page surface while the application's global language remains parent-owned.

## Five critique and improvement passes

1. **Claim audit.** Removed inherited "first agentic CRM", hardcoded 4.4k stars, live system-health claims, unowned product referral and pseudo-customer demonstrations. GitHub and documentation links now belong to the authenticated user's Tayvero repository. No testimonials, customer counts, quantified ROI or provider partnership claims remain.
2. **Information architecture.** The hero answers what the product is, why context/control matter and what to do next. Actual fixture artwork follows it. Capability rows distinguish CRM, agents and bounded import; governance is an ordered sequence rather than interchangeable icon cards. A readiness FAQ precedes the open-source call to action.
3. **Honest product proof.** Replaced the inherited hand-authored company mockup/logowall with the parent's actual React-component screenshot, explicitly captioned as demonstration data. No authenticated backend or production verification is implied. The copy distinguishes dedicated-workspace deployment, partial RU/UZ/EN coverage, implemented provider code and unfinished channels/features.
4. **Interactions and resilience.** Preserved `github_star_clicked` and `setup_prompt_copied` events and the host allowlist. Removed fabricated star counts. Copy success fires telemetry only after clipboard success; denied/unavailable clipboard reveals a manually selectable shared Textarea. Timers are cleaned up. Native FAQ disclosure works with keyboard. Auth CTA still points to `/sign-in`; section links, skip link and source links are real. A subsequent concrete audit found an inherited PostHog account key: removed that dependency from landing and introduced explicit owner enable/key plus browser DNT checks. Autocapture, automatic pageview/pageleave, replay and person profiles are disabled. Parent repaired server ownership; shared docs/env now describe the actual default-off policy.
5. **Responsive / implementation review.** Scoped layouts move from asymmetric columns to a single column; controls wrap, headings use bounded fluid sizes, images reserve dimensions and use Next Image responsive sizes. Explicit focus treatment, reduced-motion entrance and forced-colors fallback are included. Deleted ten orphaned inherited landing demo/helper modules after a repository reference audit. Relative imports resolve; TypeScript parser reported no syntax errors; owned files pass Biome; existing analytics tests pass.

These are concrete review outcomes, not a claim that software cannot be criticized. Full application build/type verification and final desktop/mobile capture evidence are coordinated by the parent.

## Executed evidence

- `bun test apps/app/test/landing-analytics.spec.ts apps/app/test/landing-analytics-policy.spec.ts` using the installed Bun 1.3.12 executable — 10 passed, 0 failed, 20 assertions. New tests cover default no-op, missing/blank owner key, explicit enable, browser DNT and retained host boundaries.
- `biome check apps/app/components/landing apps/app/app/(landing)/page.tsx apps/app/test/landing-analytics-policy.spec.ts` — owned files checked/formatted; no remaining diagnostics after adopting Next Image.
- TypeScript parser over current landing TS/TSX modules — no syntax diagnostics.
- Relative import inventory over the landing tree — no unresolved local import targets.
- Settled light/dark public screenshot paths exist, copied from the parent's final 1080 × 720 component fixture captures. Theme-specific Next Images have matching reserved dimensions. Captured UI and data are explicitly demonstration-only. README references updated to the actual JPG files.
- Source scan found no remaining `REPO_STARS`, `github.com/crm`, `4.4k`, inherited "first agentic" claim, "All systems normal" or referral `product.example?` in the landing scope.

## Remaining evidence boundary

The parent's preview harness mounts the actual landing under `/demo/landing` with Next link/image fixture adapters; provider side effects and authentication are not tested by that preview. The main application's release readiness remains governed by build, PostgreSQL, authenticated E2E and provider/backup gates. Existing analytics host policy was intentionally preserved, so localhost/self-hosted installs do not emit landing telemetry through this path.
