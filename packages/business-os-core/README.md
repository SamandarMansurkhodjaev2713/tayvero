# Business OS Core Safety Primitives

Deterministic, dependency-free reference implementations for platform-critical rules: canonical payload hashing, idempotency, exact money values, agent action policy/approval binding, bounded retry, outbound connector SSRF protection, pipeline validation, deal-health evidence, import normalization and ROI arithmetic.

These modules are additive foundations. They are not considered fully integrated until application adapters call them at the real database/tool boundaries and integration tests prove those paths.

Run:

```bash
node --test packages/business-os-core/test/*.test.mjs
```
