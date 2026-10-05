# Security Threat Model

## High-value assets

Tenant CRM records, communications, files, OAuth tokens, API keys, model prompts/context, agent approvals/actions, audit logs, financial values and identity/session data.

## Trust boundaries

Browser ↔ application; public webhook ↔ ingestion; API ↔ database/cache/queue; worker ↔ provider; model ↔ tool layer; tenant ↔ tenant; user ↔ privileged administration; connector ↔ internal network.

## Principal threats and required controls

- Cross-tenant access: tenant predicate at repository boundary, object authorization, cache/index partitioning and automated negative tests.
- Credential theft: envelope encryption/KMS, masked reads, rotation, least scopes and log redaction.
- Prompt injection: isolate untrusted content, immutable system policy, tool allowlist, schema validation and side-effect approval.
- SSRF through generic connectors: HTTPS/host allowlist, DNS/IP validation before and after resolution, private/link-local/metadata blocking and redirect revalidation.
- Webhook replay/spoofing: provider signature, timestamp window, nonce/event uniqueness and idempotent processing.
- Agent privilege escalation: deny by default, immutable version manifest, server-side authorization and approval payload binding.
- Data destruction: soft delete where appropriate, audit, backups, retention, export controls and tested restore.
- Supply chain: lockfile, dependency review/audit, minimal dependencies and CI permissions.
- PII leakage: data minimization, field classification, redacted observability and retention/deletion workflows.

## Release blockers

Hard-coded secrets, unvalidated external/model payloads, missing object authorization, cross-tenant query path, irreversible action without policy/idempotency/audit, unbounded public endpoint, production network call without timeout or destructive migration without recovery plan.
