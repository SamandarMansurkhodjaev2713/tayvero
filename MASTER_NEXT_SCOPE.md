# MASTER_NEXT_SCOPE — 6 октября 2026

Продолжать от текущего tayvero-master-2026-10-06.zip / публичного main. SHA конечного ZIP — внешний MASTER_SHA256.txt. Исторический source ZIP отсутствовал и не был заново сертифицирован.

Primary NEXT_SCOPE_ID: CRM-AUTHENTICATED-BROWSER-001. Core HTTP owner/admin/member/revoked и CRM next-step flows выполнены на настоящих signed sessions и isolated PostgreSQL. CI16 подтвердил pipeline3/3 и operations17/17, zero skips; schema diff пуст. Браузерные owner/admin/member journeys, signed-session approval mutations и worker/native staging остаются отдельными. Независимый pipeline code next: CRM-PIPE-SHADOW-READ-006.

После DB acceptance: MIG-APPROVAL-AUTHENTICATED-E2E-001, MIG-WORKER-STAGING-001, AGENT-APPROVAL-NATIVE-ACCEPTANCE-001. Независимое code next: AGENT-CONTINUATION-RECONCILIATION-001.

Только explicit isolated TEST_DATABASE_URL, никогда production DATABASE_URL. Сначала .env configuration, затем bun install --frozen-lockfile. Prisma codegen, semantic checks и Next build уже выполнены, но не заменяют реальную БД, worker/native/provider acceptance. Все guarded writes/continuation/background flags остаются под прежним default-OFF rollout.

Не выдавать UI fixtures за authenticated application E2E. Для следующей UI проверки: real owner/admin/member/revoked sessions, 320/393/768/1440px, все4палитры и оба режима, keyboard/focus/reduced motion, slow/error/empty/stale query и clipboard denied. Shared rules — DESIGN.md и docs/design.md.
