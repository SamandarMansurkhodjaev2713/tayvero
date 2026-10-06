# MASTER_EXTERNAL_GATES — 6 октября 2026

| Gate | Фактический статус | Что остаётся |
|---|---|---|
| Linux dependency-free regression | 584/584, zero skipped, финальный source CI | Authenticated application acceptance остаётся отдельно |
| Semantic toolchain | 13/13 tasks passed | Финальный evidence в design-toolchain-review.json |
| Native Next production | exit0,36/36pages | Authenticated E2E и deployment configuration |
| CRM-PIPE-POSTGRES-005 | VERIFIED: финальный CI 3/3, zero skipped | Следующий shadow-read scope под default-OFF rollout |
| MIG-APPROVAL-POSTGRES-001 | VERIFIED: финальный CI 17/17, zero skipped | Authenticated E2E и staging остаются отдельными |
| Eve native packaging | ENOSPC на Windows | Достаточные ресурсы + locked runtime packaging/acceptance |
| MIG-WORKER-STAGING-001 | NOT_VERIFIED | Два процесса, private POSIX volume, supervisor, restart/revocation/draining |
| Authenticated app E2E | NOT_VERIFIED | Owner/admin/member/revoked, real routes/query/mutations |
| Providers / backup / restore / load | NOT_VERIFIED | Реальные подтверждения в разрешённом окружении |

Локально TEST_DATABASE_URL отсутствует; process-only dummy localhost DATABASE_URL использовался для codegen, не acceptance. CI использует disposable PostgreSQL16 и явно named _test database; production database не подключалась. Windows POSIX failures не пропущены и не превращены в green. Business provider calls=0.

Не завершены кодом: полный onboarding/channels/proposals/Outcome/shared-tenancy, XLSX/deal/link import, terminal-source policy, exhaustive source pagination и worker health supervision. Эти задачи не сводятся к предоставлению credentials. Guards, default-OFF rollout и legacy Deal.stage authoritative сохранены.

Полный quality gate: https://github.com/SamandarMansurkhodjaev2713/tayvero/actions/runs/37323135330; source commit `7b0906330874ac8bd561ce928534520e2acce645`, conclusion=success. Полная Linux упаковка и финальные security checks прошли; Windows ENOSPC сохранён как отдельная историческая попытка. Это не запуск locked native runtime и не worker/provider staging.
