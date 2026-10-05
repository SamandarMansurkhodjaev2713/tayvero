# Release lint and accessibility review — 2026-10-05

The original root Biome report had 38 errors: 19 control-character regex findings, four cognitive-complexity findings, two function-length findings, three callback-return findings, one implicit `any`, and nine accessibility findings. The source fixes retain the configured rules and thresholds; no global suppression, unsafe fix pass, or permissive safety rule was added.

## Five findings addressed

1. **Security intent was indistinguishable from an accidental control-character regex.** Eight security-boundary files now explain the intentional rejection or sanitization beside the exact original regex. The narrow `biome-ignore lint/suspicious/noControlCharactersInRegex` comments preserve every pattern, flag, maximum length, and surrounding rejection branch. No provider, tenant, source-path, or approval guard was relaxed.
2. **Large validation and execution functions obscured their phases.** Object-schema recursion, stage transition validation, pipeline stage persistence, approval consumption, and bounded executor retries now have cohesive helpers. Migration scope/report/duplicate/dependency helpers and continuation evidence helpers reduce factory length. Evaluation order, error codes, shared duplicate/error sets, the existing transaction client, receipt lifecycle, cancellation checks, retry limits, and `transactionMaxAttempts: 1` for borrowed migration transactions remain intact.
3. **A pipeline checkbox label did not explicitly identify its control.** Each allowed-previous-stage label now points to its Radix checkbox ID. The ID derives from the existing unique stage editor ID and source key. The existing checked, disabled, and transition update behavior remains unchanged.
4. **Accessible names and button defaults were incomplete.** Deal attention weights have an explicit screen-reader text alternative, avoiding an unsupported name on a generic span. The standalone preview avatar has an image role for its initials and accessible name. Standalone fixture buttons and native preview record buttons explicitly use `type="button"`.
5. **The preview delegated a click through a static wrapper.** The harness now observes the same nuqs search-dialog key as the production header within its adapter. The existing native header button drives the preview dialog through the shared state, including keyboard activation. Production header behavior was not changed. Iterable callbacks now use block bodies without returning values; the legacy pipeline bridge plan has its actual `ReturnType` instead of implicit `any`.

## Actual checks

| Check | Result and evidence |
| --- | --- |
| Root Biome lint | **PASS:** 1,107 files, 0 errors, 87 warnings, 12 informational findings. [`design-lint-results.json`](design-lint-results.json) is the actual JSON report. Shared UI component exclusions are the existing root configuration; this does not claim lint coverage of those excluded files. |
| Root Biome check | **PASS:** final check after the source fixes and review artifacts: 1,107 files, 0 errors, 87 warnings, 12 informational findings. This includes formatting and import organization in addition to lint. |
| Portable behavior suites | **PASS:** 202 tests, 0 failures, 0 skips. [`design-lint-tests.tap`](design-lint-tests.tap) records action registry, governed action runtime, security core, integration runtime, migration core, pipeline runtime, public error, pipeline editor, and legacy bridge suites. |
| Boundary and continuation wiring suites | **PASS:** 30 tests, 0 failures, 0 skips; checks cover governed action calls, migration persistence, pipeline API/dual write, and native continuation wiring. |
| JavaScript syntax | **PASS:** `node tools/quality/check-esm.mjs` checked 205 files, no failures. |
| TypeScript syntax | **PASS:** `node tools/quality/check-typescript-syntax.mjs` checked 995 files with TypeScript 5.9.2, no failures. This is syntax verification, not the monorepo typecheck. |

The migration and pipeline feature gates retain their existing default-off behavior. The bridge still leaves legacy `Deal.stage` compatibility in place; the extracted stage persistence helper uses the same already-scoped transaction client.

The broader first Node test attempt included migration source filesystem suites and failed the required POSIX/O_NOFOLLOW configuration checks on native Windows. The source-store guards were preserved; Linux CI must verify those suites and PostgreSQL after the helper refactors. The preview build was also attempted with Node; its existing `Bun.resolveSync` dependency requires Bun, so that invocation did not validate the bundle. No browser session, authenticated acceptance, production deployment, or complete accessibility conformance is claimed by this review.
