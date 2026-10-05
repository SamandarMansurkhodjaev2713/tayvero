# Tayvero — cumulative master, 18 сентября 2026

## Единственный baseline
`tayvero-master-2026-09-15.zip`, SHA-256 `6f24d40c4077a92f6622ad8c8870944ec864ab64437acdd49bb353a9a4b02fcf`.
1428 файлов; CRC/структура/hash проверены. До изменений: 535/535 local tests и 15/15 gates.

## Результат
`tayvero-master-2026-09-18.zip`, корень `crm-release/`.
**IMPLEMENTED_EXTERNAL_VERIFICATION_REQUIRED; wholeProductProductionReady=false.**
SHA конечных ZIP-байтов и fresh archive replay добавляются во внешние MASTER_SHA256/MASTER_REPORT.
Внутренний отчёт не заявляет самоссылочный hash.

MIG-SOURCE-LIFECYCLE-001: persisted deletion intent -> authenticated physical removal -> purged acknowledgement;
source audit, shared source lock for prepare/delete, bounded retention preview/confirm, orphan-ID tombstones.
MIG-BACKGROUND-WORKER-001: explicit admin consent per job, background queue/lease/version, same coordinator and
row receipts, role/owner checks, finite retry, draining pause, worker CLI + UI. Default OFF; supervisor не запущен.
Дополнительная защита FIFO: O_NONBLOCK перед fstat; реальный локальный filesystem test.

## Файлы
1428 -> 1446. Добавлено 18, изменено 34, удалено 0.
Полные списки и hashes изменённых файлов — MASTER_REPORT. Документы/тесты входят в эти количества.

## Проверки
571/571 dependency-free tests, fail/skip/cancel=0. 15/15 local gates.
195 ESM syntax, 907 TS/TSX/parser (TypeScript 5.8.3, НЕ semantic typecheck), 20 manifests.
Strict governed boundary 0; tenant ratchet 15 прежних/0 новых, baseline unchanged. Все темы сохранены.
New actual PG acceptance tests: 4 написаны, 0 выполнены. DB gates вызваны и BLOCKED_EXTERNAL.
Новые UI/CLI native wiring требуют Bun/Prisma/build/authenticated/browser/process acceptance.

## БД и rollout
Две additive SQL migrations: 20260918090000_migration_source_lifecycle и 20260918091000_background_import.
Не применены. Реальных DB writes/provider calls 0. Prisma/native codegen не выполнялись.
MIGRATION_BACKGROUND_ENABLED=0, прежние write/continuation flags также OFF. Legacy Deal.stage authoritative.
Rollback: pause/drain/stop worker, выключить flags; сохранить expansion schema/events/tombstones/receipts/keys.

## Честные ограничения
Cleanup не удаляет НИ ОДНОГО источника, связанного с любым job, включая terminal. Quota20/history25 остаются.
Bounded 25 candidates/100 aged rows/1000 FS entries не равны exhaustive pagination; temp/corrupt/unkeyed files
остаются для review. Нет terminal-source policy/object store/worker health supervision. Worker не начинает
работать от одного флага: нужен реально запущенный процесс и общие DB/volume/keys. Pause допускает окончание
уже claimed batch. Нет XLSX/расширенных импортов, полного onboarding/channels/proposals/Outcome/shared tenancy.
Оставшиеся задачи не сводятся к предоставлению credentials.

Primary NEXT_SCOPE_ID: CRM-PIPE-POSTGRES-005. Parallel: MIG-APPROVAL-POSTGRES-001.
Staging: MIG-WORKER-STAGING-001; native: AGENT-APPROVAL-NATIVE-ACCEPTANCE-001.
Independent code next: AGENT-CONTINUATION-RECONCILIATION-001.
Готовность оценивается release gates, не процентом по числу тестов. См. MASTER_NEXT_SCOPE/runbook.
