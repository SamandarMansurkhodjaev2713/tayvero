# MASTER_EXTERNAL_GATES — 18 сентября 2026

## Внешние gates, фактически не пройденные

| Scope | Статус | Что требуется |
|---|---|---|
| CRM-PIPE-POSTGRES-005 | BLOCKED_EXTERNAL | Реальная disposable PostgreSQL: migration/backfill/concurrency/reconciliation |
| MIG-APPROVAL-POSTGRES-001 | BLOCKED_EXTERNAL | Prisma generation и все source/receipt/approval/continuation/lifecycle/worker DB tests |
| FULL-TOOLCHAIN | BLOCKED_EXTERNAL | Bun 1.3.12, frozen dependencies, formatter/lint, semantic types, native codegen/build |
| MIG-WORKER-STAGING-001 | BLOCKED_EXTERNAL | Авторизованные API/Next, supervisor, две реальные worker процессы, shared volume, restart/revocation |
| AGENT-APPROVAL-NATIVE-ACCEPTANCE-001 | BLOCKED_EXTERNAL | Locked Eve 0.29.4, exact child sessions, hooks/routes, once-only side effects |
| AUTHENTICATED-APP-E2E | BLOCKED_EXTERNAL | Новые UI flows, roles/proxy, темы/responsive/keyboard/assistive technology |
| BACKUP-RESTORE/LOAD/LIVE PROVIDERS | BLOCKED_EXTERNAL | Реальное эксплуатационное доказательство, не только локальные unit tests |

Node22 и TypeScript parser есть. Bun/psql/postgres/initdb/docker/dependency tree/TEST_DATABASE_URL отсутствуют.
Повторные обращения к registry.npmjs.org и deb.debian.org завершились curl exit6 (DNS). Оба DB-gate фактически
вызваны; BLOCKED_EXTERNAL, не green skip. Логи и environment.json сохранены. Реальных DB/provider вызовов 0.
Две новые SQL-миграции и четыре дополнительных PostgreSQL acceptance-теста написаны, НЕ применены/выполнены.

## Это незавершённый КОД, не внешние blockers

- Guided reconciliation для неопределённого agent continuation/action; bounded terminal/orphan ticket retention.
- Referenced/terminal migration-source retention/архивирование, quota policy, temp-file janitor, exhaustive source
  inventory pagination, object-storage adapter, worker heartbeat/alerting. Новый worker реализован, но не развёрнут.
- XLSX, сделки/связи/custom fields/merge/update, расширенная история/объёмы и direct Bitrix24/Kommo adapters.
- Полноценные self-maintaining proposals/remediation, Outcome Ledger/CEO Brief, полезные каналы и onboarding.
- Telegram/WhatsApp/1C, unified Inbox, полная RU/UZ/EN, provisioning/shared tenancy/credential migration.

15 старых tenant findings остаются. Никаких новых baseline exemptions. Dedicated workspace не стал shared SaaS.
ERP/HR-suite/telephony/marketplace/MCP ecosystem/multi-region — DEFERRED_BY_DESIGN.

## Что нужно предоставить через среду, не через чат

Network-enabled dev/CI, explicit disposable TEST_DATABASE_URL, locked toolchain; затем HTTPS staging, два admin,
разные роли и реальные worker процессы. Для источников — проверенный private persistent POSIX volume, одинаковый
service UID и исторические ключи через secret manager. Согласованный backup/restore DB+volume+keys обязателен.
Не подставлять production DATABASE_URL в тесты, не применять новые миграции к клиенту автоматически. Все новые
flags OFF. Legacy Deal.stage authoritative; после реального pipeline gate нужны shadow/observation, не auto cutover.
