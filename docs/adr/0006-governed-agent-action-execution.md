# ADR-0006: Governed agent action execution

## Context
LLM output is untrusted and must not invoke side effects directly. Existing action manifests require one enforcement path for validation, authorization, policy, approval, idempotency, execution and audit.

## Decision
All model-proposed actions cross `createGovernedActionExecutor`. The trusted tenant/actor context is injected by the application boundary, never read from the proposal. High-risk actions consume a tenant- and payload-bound approval. Mutations use an atomic receipt-store contract. Executors receive a bounded abort signal and their output is runtime-validated.

## Consequences
Adapters must provide durable database-backed approval and receipt stores in production. In-memory stores exist only for deterministic tests. Direct executor access remains forbidden and is tracked as migration work until every legacy call site uses the composition service.
