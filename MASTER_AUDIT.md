# MASTER_AUDIT — 5 октября 2026

Актуальная функциональная acceptance: source `6b83173`, CI16 `37461560544`, `docs/quality/product-toolchain-review.json`. Более ранние design-checkpoint сведения ниже сохранены как история; текущие результаты приведены в closing section. Whole-product production readiness не заявляется.

Текущий аудит относится к существующему checkout и дизайну/публикации 2026-10-05. Исходный ZIP отсутствовал: исторические counts/hash ниже не воспроизводились заново. Полные актуальные факты — MASTER_REPORT.json и docs/quality/design-*.

Независимое UX-ревью:11 проверок,2P2 исправлены, P0/P1 в проверенном scope не найдено. В отдельных lane зафиксированы минимум5 конкретных критик/исправлений. Это целевой аудит, не заявление о ручной построчной проверке всего репозитория или идеальности.

Реальный CI5:580/580 Node, pipeline3/3, operations17/17, zero skipped, пустой Prisma schema diff. Найденный aborted-transaction retry исправлен новой транзакционной границей; исторические SQL migrations/indexes не удалялись. Три fixture-запроса усилены workspaceId; tenant ratchet15 прежних/0 новых, baseline не расширен. Семантика13tasks/Next36pages проверены отдельно; nativeWindowsEve ENOSPC и authenticated E2E/providers/staging не скрыты.

## Историческая запись предыдущего checkpoint

Ниже исходный audit, сохранённый для контекста. Его датированные заявления не являются новым evidence 2026-10-05.

# MASTER_AUDIT — 18 сентября 2026

## База и границы
Только tayvero-master-2026-09-15.zip, SHA 6f24d40c4077a92f6622ad8c8870944ec864ab64437acdd49bb353a9a4b02fcf.
535 исходных локальных тестов и 15 gates воспроизведены до изменений. Перепроверены предыдущие master docs,
исходники migration/coordinator/source storage/права, затронутые API/UI/schema и тесты. Это целевой аудит двух
приоритетных направлений и смежных инвариантов, не заявление о ручной построчной проверке всего репозитория.

## Исправления и результаты критических проверок

1. Удаление источника ранее не разделяло persisted intent и acknowledgement фактического удаления.
   Теперь tombstone -> authenticated unlink -> purgedAt + application audit. FS не находится внутри retriable
   SQL callback. Сбой после unlink восстанавливается без повторного создания источника или удаления receipts.
2. Подготовка задания и удаление источника используют общий source-version lock. Любая ссылка job защищает
   файл, в том числе после terminal status. Нельзя добрать quota ценой удаления доказательств.
3. Опубликованный orphan получает уникальный tombstone до unlink; delayed upload не может зарегистрировать
   удалённые bytes как доступный источник. Уникальный ID, digest и повторные проверки защищают границу.
4. Два concurrent unlink обрабатывают ENOENT идемпотентно. Retry после пропавшего файла завершает directory sync.
5. Подмена .source на FIFO могла зависнуть на open до проверки fstat. Добавлен O_NONBLOCK; реальный mkfifo
   воспроизведён в локальном тесте. Symlink/permissions/hardlink/nonregular guards не ослаблялись.
6. Фоновый runner не получает бессрочную привилегию: явное consent, текущий requesting admin, исходный owner,
   сохранённый plan, тот же coordinator и атомарные row receipts. Queue claims имеют отдельную версию и lease.
7. Pause не отменяет уже claimed batch, но выключает последующие. Stale acknowledgement не включает job назад.
   Проверены pause до claim и во время batch, cancellation, конкурирующие worker и замена app после сбоя.
8. Unknown failures останавливают scheduling; transient backoff ограничен. Raw SQL/DSN/данные строки не идут
   в новые worker logs. Сервис без реально запущенного worker не объявляется healthy.
9. UI показывает pending purge, partial plan, review-required outcomes, scheduled/paused state и явное согласие.
   Все три locale имеют ключи; исходные темы не форкались. Реального browser E2E здесь не было.

## Доказательства
571 dependency-free тест, 15 локальных gates, реальные Node filesystem/crypto/FIFO/unlink проверки.
Сценарии БД используют serialized query-contract double — НЕ PostgreSQL. Два SQL expansion-файла не применены.
Четыре новых PostgreSQL acceptance-сценария добавлены в существующий operations suite, но не запускались.
TypeScript parser (5.8.3) не заменяет закреплённый семантический compiler/typecheck. Ручной scaffold tRPC
синхронизирован с новыми методами, native generator не выполнялся. Нельзя считать его интеграционно проверенным.

## Оставшиеся риски
Все 15 исторических tenant findings остаются, новых 0; shared tenancy не доказана. Retention защищает terminal
job sources; quota20 и bounded history25 не сняты. Cleanup не является exhaustive directory traversal: лимиты
100 aged rows/1000 filesystem entries/25 candidates, без полного pagination. Temp/corrupt/unkeyed artifacts не
удаляются автоматически. Нет object storage/terminal-source archive policy и production heartbeat/supervisor.
Нет реального DB concurrency, process deployment, browser/native Eve acceptance, backup/restore/load evidence.
Также остаются XLSX/расширенные импорты, каналы/onboarding, proposals/Outcome и operator action reconciliation.
Полный список и порядок — MASTER_EXTERNAL_GATES и MASTER_NEXT_SCOPE.

## Functional source CI16 — 2026-10-06

Application commit 6b83173d76fec2089968f1a86e9a4636079d68f8; https://github.com/SamandarMansurkhodjaev2713/tayvero/actions/runs/37461560544: both jobs SUCCESS. Node 593/593, Bun 1477/1477 (eight uncached leaves), 39 separate contract/SSR assertions, PG pipeline3/3 and operations17/17, zero failures/skips in Linux acceptance. Lint9/9 and semantic13/13 uncached; build4/4 (two prerequisite cache hits), Next36/36 and Eve packaging passed. Security26/26, vault valid, tenant15existing/0new with unchanged fingerprints; deployed schema diff empty. Local signed-session HTTP/contract acceptance15/15. Windows Node593/520pass/73exactretainedPOSIXfailures, zero new/skip/cancel/todo; full API Windows source-store failures retained separately. Whole-product production readiness false. Browser/live-provider/native worker/staging acceptance remains separate.
