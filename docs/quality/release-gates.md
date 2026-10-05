# Release Gates

## Gate 1 — Repository

Valid manifests, no BOM, no committed first-party secrets/legacy identity, lockfile present, clean generated artifacts policy.

## Gate 2 — Static

Formatter, lint and typecheck pass. New external inputs have runtime schemas. Public contracts are documented.

## Gate 3 — Data and security

Tenant/object authorization, constraints/indexes, migration safety, credential treatment, file/webhook/connector threat review.

## Gate 4 — Tests

Affected unit, integration, contract and E2E pass. Bugs have regression tests. Concurrency/idempotency tests exist when realistic.

## Gate 5 — Runtime

Build, startup, health checks, critical smoke flow and provider fakes/limited sandbox calls pass in a production-like environment.

## Gate 6 — Operations

Observability, alert, rollback, backup/restore, feature flag and incident owner are confirmed.
