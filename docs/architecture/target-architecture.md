# Target Architecture

## Product boundary

The near-term product is a self-maintaining CRM. The long-term platform is an Agentic Business OS. CRM remains the system of record; agents remain governed executors; integrations remain explicit adapters rather than hidden model capabilities.

## Logical layers

1. Presentation: role-aware web/PWA experiences, Inbox, CRM, Insights, Agents and Connections.
2. Application: use cases, authorization, transactions, orchestration and policy decisions.
3. Domain: CRM, pipeline, communication, agent, approval, integration and metric invariants.
4. Infrastructure: Prisma/PostgreSQL, queue, cache, object storage, providers and observability.
5. Trust layer: tenant scope, RBAC, secrets, audit, retention, budgets and kill switches.

## Bounded contexts

- Identity & Tenancy
- CRM Core
- Communications
- Pipeline & Revenue
- Agent Runtime
- Agent Governance
- Integrations
- Migration
- Knowledge & Evidence
- Analytics & Outcomes
- Billing & Entitlements

## Deployment shape

Retain a modular monolith initially: web application, API, durable agent/ingestion worker, PostgreSQL, queue/cache and object storage. Extract services only when measured scaling or isolation requirements justify the operational cost.

## Event contract

All business events use an explicit envelope with event ID, version, tenant ID, occurred/recorded timestamps, actor, correlation/causation IDs and validated payload. Consumers assume at-least-once delivery and are idempotent.

## Data strategy

Use relational columns and constraints for core CRM invariants. Keep extensibility through metadata-driven custom fields and later custom objects; do not convert critical data into an unbounded EAV model. Large attachments live in object storage with hash, size, media type and tenant-scoped storage key in PostgreSQL.

## Evolution order

Hardening → tenant isolation → configurable pipelines → migration → unified communications → governed agent actions → Control Center → Deal Intelligence → Integration Studio → custom objects/non-CRM agents → global control plane.
