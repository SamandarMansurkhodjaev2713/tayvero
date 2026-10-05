# MASTER_NEXT_SCOPE — 18 сентября 2026

Единственный baseline для следующей работы: `tayvero-master-2026-09-18.zip`.
Точный SHA финальных ZIP-байтов — внешний MASTER_SHA256.txt / MASTER_REPORT.json рядом с архивом.

Primary NEXT_SCOPE_ID: `CRM-PIPE-POSTGRES-005`.
Parallel: `MIG-APPROVAL-POSTGRES-001` (включает новые lifecycle/worker tests).
Process/UI: `MIG-WORKER-STAGING-001`, `MIG-APPROVAL-AUTHENTICATED-E2E-001`.
Native agent: `AGENT-APPROVAL-NATIVE-ACCEPTANCE-001`.

```sh
bun install --frozen-lockfile
bun run gate:pipeline-postgres
bun run gate:operations-postgres
bun run quality:gate
```

Только isolated TEST_DATABASE_URL. Не ослаблять assertions и не подменять её production DATABASE_URL.
MIG-SOURCE-LIFECYCLE-001 и MIG-BACKGROUND-WORKER-001 реализованы и проверены локально, но не выданы за
production-verified. Новые migrations не применены, Prisma/native codegen/full semantic types/build отсутствуют.
Нельзя просто включить flags и считать полную систему испытанной.

После DB/toolchain acceptance: migration-source-lifecycle-and-worker runbook, supervisor, shared source volume,
ключи и два concurrent процесса; restart после row commit, pause/cancel/revoke; authenticated browser в темах.
Native continuation — отдельная матрица approval-continuation-operations.md. Старый Deal.stage не переключать
сразу после одного зелёного DB теста: сначала shadow reads и наблюдение.

Если внешняя среда остаётся недоступной, следующий независимый high-value code scope:
`AGENT-CONTINUATION-RECONCILIATION-001` — операторская сверка неопределённого исхода по evidence, без unsafe
reset/whole-run replay и без ручного объявления success. Затем lifecycle source-history policy/pagination,
meaningful channel+onboarding и self-maintaining proposals/Outcome instrumentation.

Retention сейчас сознательно сохраняет ВСЕ referenced sources, в том числе terminal. Не удалять их ради quota20;
не считать bounded scan полноценным janitor всех temp/backup/object-store данных. Новый worker делает импорт
независимым от страницы только когда он реально запущен; расписание не означает health.

Начать с SHA/CRC/master docs и baseline tests. Сохранить текущие темы/namespace/guard baselines. Итог следующего
прохода: один cumulative ZIP, реальные diffs/test logs, внешние gate статусы и повтор из свежей распаковки.
