# ADR 0013 — Fail-closed execution, durable preparation and selectable appearance

Date: 2026-09-13. Status: accepted for the local hardening scope; deployment gates
remain separate. No schema migration, package namespace rename or read cutover.

## Decisions

1. Side effects cannot be assumed absent after a timeout or worker crash. Unsafe
   expired receipts are quarantined as AMBIGUOUS, committed before a surfaced
   error. Whole-run retry is denied where attempted effects or incomplete action
   history could otherwise create fresh keys and repeat an external operation.
2. Migration settlement uses version, owner and unexpired lease fencing. Claim
   attempts count even when a worker dies. Invalid row accounting is terminal,
   not a transient error hidden behind retries.
3. HTTP connectors reject cross-origin redirects and bound the whole operation,
   including DNS/retry delay. Unsafe-method retries require explicit provider
   idempotency support. This chooses safety over silently following more URLs.
4. Integration tests require explicit isolated TEST_DATABASE_URL; no URL derived
   from live credentials and no automatic destructive rebuild on drift. Explicit
   reset needs both --reset and a one-off environment consent. Name suffixes do
   not prove isolation; remote aliases remain an operator responsibility.
5. Source preparation uses an authenticated encrypted file store for a dedicated
   persistent POSIX deployment. There is no pretend S3 adapter or public upload
   endpoint. The command is labelled preparation-only and never writes CRM rows.
6. Appearance is one semantic token system, not four parallel component trees.
   Four palette pairs share layout/accessibility behavior. Personal preferences
   have a bounded versioned schema, storage-denial fallback and prepaint bootstrap.
   The standalone fixture validates those tokens/layout samples, not real React
   hydration or authenticated business workflows.
7. Deal health is a versioned, read-only, evidence-backed rule set. Missing or
   contradictory data can yield no score. These signals are not AI forecasts,
   probability of winning or independently validated customer outcomes.
8. Dedicated-workspace membership is rechecked. This does not invent a tenant key
   on legacy CRM tables: shared database SaaS remains prohibited until separately
   migrated and tested. Existing 15 tenant audit findings remain visible.
9. Full quality tasks are mandatory. Node regression, parser checks and lock
   metadata verification are separate from Bun frozen install/format/lint/build.
   No blocked prerequisite is represented as a successful full pipeline.

## Review outcomes

Correctness review added CSV physical line accounting and exact bounded money
parsing. Trust review closed redirect/IPv6, mapping-prototype and action-payload
boundaries. Recovery review added lease fencing, ambiguous receipt quarantine and
whole-run retry denial. UX review added explicit labels, visible states, evidence
links and preference recovery without proliferating component variants. Delivery
review removed destructive test defaults and silent quality-task skips, and
separated locally proven behavior from DB/UI/provider/LLM work not executed here.

## Consequences / rollout

Some previously accepted malformed files, unsafe redirects, ambiguous retries,
removed memberships and implicitly selected test databases now fail explicitly.
This is intentional. Operators must reconcile ambiguous effects rather than
manufacture new idempotency keys. Retain source encryption keys. Keep legacy
Deal.stage reads authoritative until PostgreSQL verification and observation.
Application integration and full formatting/typecheck may need follow-up fixes
once dependencies are installed; only the documented local tests are green.
