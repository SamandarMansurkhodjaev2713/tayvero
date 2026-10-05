# Business OS Core Integration Plan

The additive modules under `packages/business-os-core` define deterministic reference behavior for high-risk platform logic. Integration must occur at real boundaries, not by copying functions.

- Idempotency key: persist as a unique constraint beside each effect/outbox action.
- Approval payload hash: store with approval, compare transactionally immediately before execution, consume once.
- Money: adapt to Prisma Decimal/integer minor units without converting through JavaScript number.
- Retry: apply only in provider adapters and jobs with a documented error classifier.
- Connector URL: validate input, every DNS resolution and every redirect; combine with egress network policy.
- Pipeline: use in command handlers plus database constraints and transition history.
- Deal health: persist score version and evidence inputs; do not present as a learned probability.
- Import normalization: run during preview and import using the same versioned transformation.
- ROI: use measured activity duration/configured labor assumptions and expose formulas.
