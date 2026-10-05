# Production Runbook

## Pre-deployment

1. Run `bun install --frozen-lockfile` and `bun run quality:gate`.
2. Validate all required environment values at startup in the target environment.
3. Confirm migration plan, lock risk, backup and rollback.
4. Confirm telemetry/log redaction and alert routes.
5. Verify tenant-isolation regression suite and critical E2E.
6. Review feature flags, agent budgets and kill switches.

## Deployment

Use immutable builds. Apply deployment-safe migrations before code only when backward compatible. For contract changes use expand → dual write/backfill → switch read → remove legacy. Keep staging, preview and production databases isolated.

## Health

Readiness must verify critical internal dependencies required to serve traffic. Liveness must not depend on optional third parties. Provider failures should degrade the affected integration rather than crash the CRM core.

## Incident response

1. Identify customer impact and affected tenant(s).
2. Stop unsafe side effects using agent/connector kill switch or feature flag.
3. Preserve logs/traces/audit and correlation IDs without exposing secrets.
4. Restore service or rollback the smallest component.
5. Reconcile partially completed effects.
6. Communicate factual status.
7. Write root-cause analysis and regression test.

## Backup and restore

Automate encrypted database backups and object-storage retention. Run scheduled restore drills into an isolated environment. Record RPO/RTO and verify record counts, constraints, critical associations and representative files after restore.
