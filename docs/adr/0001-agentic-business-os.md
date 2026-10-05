# ADR-0001: Evolve CRM into a governed Agentic Business OS

## Context

The codebase already contains CRM entities and an agent execution/audit foundation. Competing on the number of generic CRM modules would create high cost and weak differentiation.

## Decision

CRM remains the initial system of record and commercial wedge. A vendor-neutral governed agent layer will execute work across CRM and connected systems. Integrations expose typed capabilities; critical actions remain policy-controlled and auditable.

## Alternatives

- Clone broad CRM suites: rejected due scope, cost and UX complexity.
- Build a generic automation canvas first: rejected because it lacks differentiated business context.
- Build independent autonomous agents: rejected due duplicated reliability/security concerns.

## Consequences

Core CRM parity, migration and communication ingestion remain mandatory. Agent runtime, permissions, outcomes and integration abstractions become strategic platform boundaries. Non-CRM agents are introduced only after CRM safety and adoption are proven.
