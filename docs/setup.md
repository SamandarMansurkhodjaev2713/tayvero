# Setup and local development

Operational detail moved out of the rule docs. `api.md`, `agent.md` and
`environment.md` are what agents read before changing code; this is what a person
reads once.

## First run

```sh
cp .env.example .env        # fill DATABASE_URL, BETTER_AUTH_SECRET, ALLOWED_SIGN_IN
docker compose up -d        # Postgres, matching .env.example
bun run db:migrate && bun run db:seed
bun run dev                 # app :3000, api :3001, agent :2000
```

Prisma from the repo root: `db:generate`, `db:migrate`, `db:push`, `db:reset`,
`db:seed`, `db:studio`, `db:deploy`.

`dev` depends on `^dev:prepare`, so every start applies pending migrations and
regenerates the Prisma client before a single server boots. That is why the first
run needs `db:migrate` only for the seed that follows it. When the database and
`schema.prisma` have diverged past what `migrate deploy` can reconcile,
`dev:prepare` stops the whole run rather than starting servers against a schema
they do not match — reconcile with `db:migrate`, or `db:reset` when the divergence
is an edited migration that has already been applied.

## Google Cloud

- **Enable the Gmail API and the Google Calendar API** on the project.
- **Set the consent screen to User type: Internal** if you are on Workspace.
  `gmail.readonly` is a *restricted* scope, so an External app needs OAuth
  verification plus an annual CASA assessment. Going External later means the full
  review — a decision, not a checkbox.

## The agent bridge

```sh
AGENT_URL="http://127.0.0.1:2000"   # 127.0.0.1, not localhost: eve dev is IPv4-only
AGENT_BRIDGE_SECRET="$(openssl rand -base64 32)"
```

| Agent tab error | Cause |
| --- | --- |
| `503` | `AGENT_BRIDGE_SECRET` unset in the app's process |
| `401` | The two processes hold different secrets, **or** `passThroughEnv` in `apps/app/turbo.json` / `apps/agent/turbo.json` is missing the pair (Turbo is strict-env) |
| `502` | Agent not running, or `AGENT_URL` wrong |

`localDev()` accepts any loopback request, so `curl 127.0.0.1` proves nothing about
the bridge — send `-H 'Host: agent.example.com'`. `GET /eve/v1/info` is the whole
inventory, including a `diagnostics` count that finds files eve silently ignored.

## Running the agent

The agent package's default `dev` command is interactive `eve dev`. The root
Turbo task marks it interactive, so select the agent pane and press Enter before
using the eve TUI. Run `turbo run dev:headless --filter=agent` when a terminal
cannot render the TUI; that uses `eve dev --no-ui`, and the Turbo pane is the
record because only interactive development writes `.eve/logs/` for `eve logs`.
Reach for the Turbo task rather than `bun run --filter=agent dev:headless`: the
package script alone skips `dev:prepare`, so the agent would start against
unmigrated tables.

`hooks/activity.ts` is the replacement narration, **to stderr** (the TUI hides
stdout), printing shape everywhere and argument contents outside production only. It
is **not the audit trail** — `hooks/audit.ts` writes `AgentEvent` regardless.

- A second `bun run dev` fails the whole turbo run.
- An orphaned agent holds the port: `lsof -nP -iTCP:2000 -sTCP:LISTEN`.

### Nothing is researching, and the queue only grows

**`eve dev` never fires schedules on their cron cadence**, and everything visible
still works — the row is written, the sheet says *Queued*, and `dispatch.ts` is never
called. The poke covers this **only when `AGENT_BRIDGE_SECRET` is set**; unset,
`poke()` returns silently and the queue looks exactly like a slow agent.

Tasks the API did not write (`schedule_recheck`) and anything queued while the agent
was down still need a manual run:

```sh
bun run --filter=agent dispatch    # exact production path, both lanes, real credits
```

Its printed `sessionIds` are research rows only, so a run that resolved forty logos
prints an empty list and was not idle. `eve start` and Vercel do run the schedule.

## `vercel env pull` writes `.env.local`, which wins

`.env.local` is the override the loader reads *last*, and `vercel env pull` writes
**production** credentials there by default. Pull once and every process silently
points at production — not as an error, but as `bun run dev` working perfectly against
the live database. On 2026-08-01 eleven migrations landed on Neon from a laptop.

1. **Pull somewhere inert**: `vercel env pull .env.vercel`.
2. **`packages/db/scripts/require-local-db.ts` guards `db:migrate`, `db:push`,
   `db:reset`, `db:seed`** and takes `ALLOW_REMOTE_DB=1`. `db:deploy` is unguarded on
   purpose. It reads the root files directly rather than `process.env`, because Bun
   auto-loads the working directory's `.env` while Prisma's CLI only sees
   `@crm/env/load`.

## Migrations run on the production deploy, and nowhere else

`apps/api/scripts/build-func.mjs` runs `prisma migrate deploy` during the crm-api
build, gated on `VERCEL_ENV === "production"`. The schema therefore moves when the
release pull request merges and `release` deploys — with the code that needs it,
and once rather than once per branch.

Historical configuration shared one database across production, preview and local
processes. **That configuration is unsafe and is not approved for this checkpoint.**
Use distinct environment-scoped credentials and disposable preview/test databases.
A repository check cannot prove that an external deployment is configured correctly.
Do not deploy this source to customer infrastructure until environment separation,
backup/restore and migration permissions have been verified there.

### `migrate deploy` is not proof the schema is right

The build follows the deploy with `prisma migrate diff --exit-code` against
`schema.prisma` and shouts in the build log when they disagree. **`No pending
migrations to apply` only means `_prisma_migrations` has a row for every file** —
it says nothing about what the tables actually look like.

They came apart once. A `prisma db push` shaped production from a laptop, the
migration rows were recorded as applied without their SQL ever running, and
`agentConversationAttachment` went live without its `position` column. Every deploy
reported nothing pending, for days, while `conversations.builderById` returned 500.
The tell is an object in the database that no migration defines — there was an
`agentConversationAttachment_submissionId_createdAt_idx` that appears in no
migration file, only in a `db push` of an older schema.

Reconciling is one command, and it is worth reading before running:

```sh
DATABASE_URL="…" bunx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --script
```

## Secrets hygiene

`.gitignore` ignores `.env` and `.env.*` with one negation for `.env.example`, so
`.env.bak` is ignored too. `.env.example` ships no secret — placeholders are empty
strings, asserted by `packages/env/test/root.spec.ts`. **Generate your own secret**;
never reuse one from an example, a tutorial, or another environment.

## Tests

```sh
bun run --filter=api test
bun run --filter=agent test    # integration specs need explicit TEST_DATABASE_URL + isolated Postgres
```

### Test database selection is explicit and fail-closed

`bun run db:test` requires `TEST_DATABASE_URL`; it never derives a test URL from
`DATABASE_URL`. The target must be a safe PostgreSQL identifier ending in `_test`,
no longer than 63 characters. The suffix alone is NOT proof of isolation.
Canonical host/port/database identity is compared with the configured application
URL, ignoring credential/query differences and normalizing common loopback aliases.
Only loopback is allowed by default. A genuinely isolated remote test server also
requires `ALLOW_REMOTE_TEST_DATABASE=1`; this is not permission to use customer data.
DNS aliases are not a proof of different servers: the operator must establish isolation.

Create separate disposable application and test databases. Supply their URLs through
local untracked environment configuration or a CI secret store, then run:

```sh
bun install --frozen-lockfile
bun run db:test
bun run gate:pipeline-postgres
bun run quality:gate
```

The database harness creates the explicitly named test database when needed and
applies pending additive migrations. A stale/foreign migration history, schema drift,
or failed inspection causes an error. **It no longer drops/rebuilds a database
automatically.** Inspect and reconcile the cause first.

Only after independently confirming that the selected database is disposable may
an operator explicitly reset it. Both controls are mandatory:

```sh
ALLOW_TEST_DATABASE_RESET=1 bun run db:test --reset
```

This is destructive to the selected test database. Never keep the reset opt-in in
normal service configuration. Existing data and migration history are not a backup.
For an unsafe or missing target, the harness refuses before database operations.

The PostgreSQL release gate distinguishes missing prerequisites (`BLOCKED_EXTERNAL`)
from an executed failing command (`FAILED`). It requires migration application,
Prisma client generation and real transactional/concurrent integration tests before
`CRM-PIPE-POSTGRES-005` can be verified. Structural Node tests are not a substitute.
