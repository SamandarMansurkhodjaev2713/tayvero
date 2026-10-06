# TAYVERO — функциональная карта и продуктовые приоритеты

Проверено: **2026-10-06**. Аудит исходников и официальной документации; наличие кода не означает проверенную эксплуатацию всех интеграций. Пользователь уточнил аудиторию: **«для всех»**. Поэтому роли и общие задачи важнее ограничения одной страной, размером команды или отраслью: руководитель, сотрудник, оператор и администратор. Гипотезы преимущества ниже требуют пользовательских сравнительных испытаний.

Начальный снимок содержит **32 настоящих Next page entry и 24 API router**. В подсчёт не входят переиспользуемые `connection-page.tsx` и `oauth-connection-page.tsx`. Параллельный проход activation меняет onboarding; приведённый исходный барьер не является утверждением о его окончательном состоянии после того прохода.

## Восемь сценариев

| Задача и роль | Факт в коде | Следующий конкретный результат | Приоритет |
| --- | --- | --- | --- |
| Начать работу: любой сотрудник | Исходный onboarding требует website, mailbox grant и Context key; `proxy.ts` перенаправляет при `research === "required"`. ResearchForm исходно не имеет skip | Отдельно доступный основной CRM и необязательное подключение research; понятное первое действие. Изменение mailbox flow требует отдельного аудита авторизации, а не удаления защиты | P0, отдельный activation-проход |
| Зафиксировать клиента, сделку и договорённость: продавец/исполнитель | Есть CRUD contacts/companies/deals, владельцы, timeline, NOTE/TASK. `dealCreateInput` требует companyId | Последовательный сценарий «клиент → сделка → следующий шаг» на существующих API. Для частных покупателей требуется осознанное изменение модели, не фиктивная компания | P0 |
| Выбрать работу на сегодня: сотрудник | Есть `activities.myTasks`, overdue tasks dashboard и доказательные `deal-health` signals; начальный снимок не содержит отдельной tasks page | Очередь «просрочено / сегодня / без следующего шага», карточка контекста и факт, объясняющий рекомендацию. Не называть attention score вероятностью продажи | P0 |
| Работать со своей валютой: руководитель/продавец | Настройки reporting currency, manual/fetched rates, сведения об unconverted суммах. В этом проходе добавлен UZS, каталог содержит 12 валют; это не полный ISO-каталог | UZS проходит реальные контракты создания/обновления сделки и currency settings. Валюты других пользователей добавлять по подтверждённым требованиям и спецификациям; отсутствие курса сохранять как отсутствие | Реализовано в bounded-проходе |
| Делегировать и переносить задачи: руководитель | У Activity только `createdById`/`createdBy`, **нет assignee**; create не принимает исполнителя, `myTasks` и overdue dashboard фильтруют автора. Нет assignment/reschedule endpoint | Отдельно спроектировать автора и исполнителя, миграцию, правомерное назначение участнику, перенос срока и аудит. Семантика `myTasks` здесь **не менялась** | P1 |
| Перенести базу: оператор | CSV contact/company: preview/mapping, prepare без customer writes, receipts/report, cancel, ограниченный rollback, background opt-in. Deal import и XLSX не поддержаны | Объяснения проблем строк и предварительный план; после подтверждённого импорта переход к полезному CRM-действию. Rollback не обещает откат произвольных изменений | P0 |
| Поручить агенту конкретную работу: сотрудник/администратор | Builder/chat, revisions/files, versions/deploy, pause/resume, runs/history/retry/cancel, ограниченные NOTE/TASK и Slack actions | Проверяемые шаблоны миссий с контекстом записи, разрешёнными действиями и ожидаемым результатом. Начать с внутренних задач/заметок, не заявлять автономное закрытие продаж | P1 |
| Согласовать и проверить результат: руководитель/оператор | Operations/approvals/continuations, audit/receipts и deployment flags. Контракт явно возвращает `businessOutcomesInstrumented: false`, `liveProviderHealthVerified: false`; scope — deployed team agents | Клиент, точное действие, основания, версия, ограничения и ссылка на результат рядом с решением. Approval, исполнение и подтверждённый результат показывать отдельно | P1 |

## Карта маршрутов и API

Все ниже перечисленные procedures присутствуют в routers/services; полнота production acceptance оценивается отдельными release reports.

| Область | UI маршруты | Подключённые API и границы |
| --- | --- | --- |
| Вход и рабочее пространство | `/`, `/sign-in`, `/grant-access`, `/onboarding`, `/onboarding/research`; `/{slug}` | Auth; `workspace` get/members/update/setMemberRole; `users` me/list; `dashboard` summary. Dashboard считает реальные CRM данные, не доказанную экономию времени |
| Записи и повседневная работа | `/{slug}/companies`, `/contacts`, `/deals` и detail routes с IDs; sheets, quick switcher | `companies`, `contacts`, `deals`: CRUD, owners, bulk, archive/restore/purge, enrichment, relationships; `activities`: timeline/counts/myTasks/create/complete; `search`, `saved-views`, `fields`, `enrichment`. Activity task ownership ограничено автором |
| Агентская работа | `/{slug}/chat`, `/chat/[chatId]`, `/agents`, `/agents/[agentId]`, `/operations` | `conversations` builder/events/sharing; `agents` revise/files/save/deploy/lifecycle/run actions; `operations` capabilities/overview/approvals/continuations/decideApproval. Native continuation и providers требуют своей приёмки |
| Администрирование | `/{slug}/settings`, `/members`, `/api-keys`, `/currencies`, `/pipelines`, `/migrations`, `/sso`, `/tracking`, `/appearance` | `settings`, `api-keys`, `currency`, `pipelines`, `migrations`, `sso`, `tracking`. Основные deal contracts/dashboard ещё используют legacy DealStage; наличие pipeline editor не доказывает полную поддержку произвольных стадий во всех CRM-сценариях |
| Подключения | `/{slug}/settings/connections`, `/google`, `/microsoft`, `/slack`, `/slack/people`, `/intake` | `google`, `microsoft`, `slack`: status/sync/access/people/channel operations, mailbox/calendar/sync modules. Intake — явный unavailable placeholder. В обследованных native modules нет Telegram/WhatsApp providers |

Прочие подключённые infrastructure modules: CRM/database/cache, archive, backfill, health, logging, telemetry. Отдельных интерфейсов коммерческих предложений, платежей и общего calendar/task workspace в начальном снимке не обнаружено. Operations локализован EN/RU/UZ; основная CRM/onboarding ещё не полностью локализованы. `Asia/Tashkent` — default именно deal-health, а не доказанная глобальная timezone-политика.

## Официальные конкурентные факты

Все URL открыты при аудите; дата проверки — **2026-10-06**. Цены, скорость работы и превосходство не выводятся из описаний поставщиков. amoCRM и Kommo рассматриваются по отдельным документам: доступность и условия не переносятся между ними.

| Продукт | Подтверждённый сценарий | Дата документа и первичный источник |
| --- | --- | --- |
| Bitrix24 | Simple CRM включён по умолчанию и работает без отдельного lead flow; документация позиционирует этот режим для небольших sales teams | Обновлён 2025-07-09: [CRM modes](https://helpdesk.bitrix24.com/open/24207198/) |
| Bitrix24 | CoPilot суммирует email, заполняет поля, предлагает activity; замена уже заполненных значений требует подтверждения | Обновлён 2026-09-04: [CoPilot email processing](https://helpdesk.bitrix24.com/open/26042359/) |
| amoCRM | Onboarding-подсказки адаптируются к опыту; в сделках есть индикаторы отсутствующей, просроченной и сегодняшней задачи | Дата обновления на страницах не указана: [onboarding](https://www.amocrm.ru/support/starting_work/onboarding), [task indicators](https://www.amocrm.ru/support/tasks/tasks_in_leads) |
| amoCRM | AI-агент отвечает на сообщения, создаёт задачи, меняет ответственного/этап, выполняет handoff; доступны тестирование и остановка | Дата обновления не указана: [amoAI agent](https://www.amocrm.ru/support/amoai/ai_agent) |
| Kommo | Генерация агента из сайта или описания бизнеса, preview; для активации нужны channel и stage. Документация ограничивает agent incoming messages; не generic outbound autopilot | Обновлён 2026-09-04: [AI agent setup](https://support.kommo.com/docs/ai-agent-manual-setup) |
| HubSpot | Prospecting Agent имеет review-before-sending и automatic mode, уведомления о drafts; текущие enrollments сохраняют опубликованную версию play | Обновлён **2026-09-16**, актуальная открытая страница, не старый поисковый cache: [Prospecting Agent](https://knowledge.hubspot.com/prospecting/use-the-prospecting-agent) |
| Pipedrive | Pulse feed группирует follow-ups, overlooked deals и opportunities, даёт быстрые действия. Документ прямо указывает fixed rules/time triggers и отсутствие AI в этом feed. Отдельный Sales Assistant — beta для ограниченной группы | Оба обновлены 2026-09-03: [Pulse feed](https://support.pipedrive.com/en/article/pulse-feed), [Sales Assistant](https://support.pipedrive.com/en/article/sales-assistant) |

**Вывод-гипотеза:** существующая TAYVERO основа позволяет соединить факт о клиенте, рекомендованное действие, проверку полномочий и receipt в короткий рабочий сценарий. Наличие AI, approval, простого режима и task indicators само по себе не уникально. Преимущество нужно измерить одинаковыми заданиями: время до первой полезной записи/задачи, завершение follow-up, ошибки импорта/назначения и распознавание опасного действия. Этот аудит не устанавливает превосходство по этим метрикам.

## UZS: спецификация, изменение и проверка

Первичный источник — актуальный [SIX ISO 4217 List One XML](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml), атрибут `Pblshd="2026-09-17"`, загружен 2026-10-06. Запись: Uzbekistan Sum, UZS, numeric code 860, minor units 2. Историческое [официальное amendment 76](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/amendments/dl_currency_iso_amendment_76.pdf) подтверждает исходную спецификацию; текущая XML-запись проверена отдельно. SIX указан как maintenance agency на [официальной странице стандартов](https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html).

Изменение: одна запись каталога `packages/db/src/currency.ts`, существующий USD default сохранён. Existing FX service использует каталог, identity/manual/fetched provenance и null при отсутствующем rate; новый rate provider не добавлялся, live availability UZS rate не заявляется. CRM хранит Decimal(14,2), API передаёт целые cents; это допускает две десятичные позиции UZS без новой схемы.

Результат focused Bun tests: **22/22, 73 assertions**. Проверены нормализованные UZS, реальные Zod reporting/manual/deal contracts, fractional amount, manual-rate rounding/provenance, identity без database read, отсутствие cross-currency rate, неверные codes и невалидные rates. Использован явно заданный nonconnecting localhost fixture URL на порту 1; tests не выполняют DB queries и не являются PostgreSQL integration acceptance. Biome scoped check — **3 файла, без ошибок**. Semantic types базы и API прошли: `node node_modules/typescript/bin/tsc --noEmit -p packages/db/tsconfig.json` и `node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json`, оба exit 0.

## Пять критических линз и результаты уточнения

1. **Реальные роли:** снято исходное ограничение 5–25 человек/Узбекистан; UZS — дополнительная валюта, не основание ограничивать продукт одним рынком. Поддержка «для всех» не означает уже реализованные отраслевые сценарии.
2. **Факты против маркетинга:** отброшены «первый AI CRM» и «у конкурентов нет approval». При конфликте marketing autopilot и operational docs использована описанная в docs область действия; старый HubSpot cache заменён актуальной страницей.
3. **Семантика задач:** creator не назван assignee. `myTasks` не изменён; необходимость relation/migration/permissions/history зафиксирована отдельно.
4. **Точность денег:** UZS metadata сверена с актуальным maintenance-agency XML. Проверены дробная сумма, rounding и отсутствие выдуманного курса; не заявлены live provider acceptance и полный мировой каталог валют.
5. **Проверяемая ценность и контроль:** приоритет — короткие рабочие сценарии, а не дополнительные декоративные dashboards. Approval не приравнен к исполнению, receipt — к ROI, rollback — к отмене любых внешних эффектов. Будущие сравнительные тесты должны измерять реальные ошибки и завершение задач.
