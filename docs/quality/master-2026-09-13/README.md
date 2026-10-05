# Master pass evidence — 2026-09-13

`*-before.log` are intentionally failing reproductions, not final gate failures.
`*-after.log` are intermediate targeted fixes; do not add their counts to the
final full suite. `baseline-local-tests.log` records 275 original tests with the
real local workspace resolver. The earlier historical broad invocation failed on
missing installed workspace module resolution; it was not silently certified.

Current final local truth: `../generated-master-local-report.json` and full log.
Current DB truth: `../generated-pipeline-postgres-005-report.json` (blocked).
Browser fixture evidence: `../preview/browser-fixture-report.json` (not React E2E).
Installation logs document DNS failures; they are not proof of working dependencies.
No customer data or provider credentials were used for these synthetic tests.
