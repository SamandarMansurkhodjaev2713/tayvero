# ADR-0002: Deny-by-default agent actions with immutable approvals

## Context

Language-model decisions are probabilistic and can be influenced by untrusted business content. Agents may initiate external communications and mutate business state.

## Decision

Every tool action is registered, schema-validated, tenant/object-authorized and evaluated by a deny-by-default policy. High-impact actions require approval bound to a canonical payload hash. Effects use idempotency at the external boundary and produce audit records.

## Consequences

Agent development requires explicit tools and policies, but incidents are containable, explainable and recoverable. Natural-language instructions never broaden permissions.
