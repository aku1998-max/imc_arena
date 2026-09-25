# IMC Arena

Mobile practice for the International Math Challenge (grades 4–6). A child practises reviewed,
grade-appropriate multiple-choice questions, sees an explanation for every answer, retries
mistakes, and a parent sees useful progress. Staff draft, independently review and publish
questions on a separate website.

This repository implements the **V1 specification** (`IMC Arena System Specification v1.0`,
25 September 2026) milestones M0–M4 and the local/mock parts of M5–M6. Production deployment,
store submission, paid services and real student data need project-owner authorization and are
**not** done here. See [docs/milestones.md](docs/milestones.md) for status and what remains.

## Architecture at a glance

| Part               | Technology                                            | Path                 |
| ------------------ | ----------------------------------------------------- | -------------------- |
| Student/parent app | React Native + Expo (SDK 57) + expo-router            | `apps/mobile`        |
| Staff website      | React + Vite                                          | `apps/admin`         |
| API                | Node.js + Fastify, zod-validated contracts            | `apps/api`           |
| Worker             | Same domain services, PostgreSQL job queue            | `apps/worker`        |
| Contracts          | Shared zod schemas and types (no DB/answer-key types) | `packages/contracts` |
| Domain             | Business rules, adapters (storage, billing, email)    | `packages/domain`    |
| Database           | SQL migrations, RLS policies, parameterized queries   | `packages/db`        |
| Design tokens      | Colours, spacing, type                                | `packages/design`    |
| Testing            | Original synthetic questions, JWT minting, DB helpers | `packages/testing`   |

All application data flows through the API. Clients never connect to tables and never hold a
service-role key. Row-level security is enabled **and forced** on every application table; the
runtime database role is not an owner, superuser or BYPASSRLS. Answer keys live in
`private.answer_keys`, reachable only through narrowly scoped grading functions.
Details: [docs/architecture.md](docs/architecture.md).

## Quick start (local)

Prerequisites: Node.js 22+, pnpm 10 (`corepack enable`), PostgreSQL 16 running locally with a
superuser `postgres` (password `postgres`, or change `DATABASE_ADMIN_URL`).

```bash
pnpm install
cp .env.example .env            # local, non-secret defaults
pnpm db:bootstrap               # creates roles imc_owner (migrations) and imc_api (runtime) + database
pnpm db:migrate                 # applies packages/db/migrations with the owner role
pnpm db:seed                    # dev staff + original synthetic questions via import -> review -> publish

pnpm dev:api                    # http://localhost:3000   (health: /health, readiness: /ready)
pnpm dev:worker                 # job runner
pnpm dev:admin                  # http://localhost:5173
```

`pnpm db:reset` drops and recreates the local database, migrates and seeds.

### Signing in locally

Adults and staff sign in with Supabase email OTP. Without a local Supabase Auth, use
development tokens signed with `AUTH_JWT_SECRET` (development/test only, refused in production):

```bash
pnpm --filter @imc/api dev:token editor          # or reviewer | administrator | parent | <uuid>
```

For the admin website set `VITE_DEV_AUTH=true` in `.env` and paste the token on the sign-in page.
For the mobile app set `EXPO_PUBLIC_DEV_AUTH=true`.

### Mobile app

```bash
cd apps/mobile
EXPO_PUBLIC_API_BASE_URL=http://<your-LAN-IP>:3000 EXPO_PUBLIC_DEV_AUTH=true pnpm start
```

Open in Expo Go or a development build. The flow: parent sign-in → consent → child profile →
_Start child mode_ (stores only a child token; adult credentials are cleared) → daily challenge.

## Tests

```bash
pnpm test                          # all unit + integration tests (needs local PostgreSQL)
pnpm --filter @imc/admin e2e       # Playwright: editor -> reviewer -> administrator publication
pnpm typecheck && pnpm format:check
```

Integration tests run against real PostgreSQL with the real migration and runtime roles
(databases `imc_arena_test`, `imc_arena_worker_test`, `imc_arena_migrate_test`, `imc_arena_e2e`
are created and reset automatically). The requirements-to-tests mapping is in
[docs/requirements-checklist.md](docs/requirements-checklist.md).

## Operator scripts

| Command                                                              | Purpose                                                                          |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm openapi`                                                       | Regenerates `docs/openapi.json` from the route schemas (CI checks it is current) |
| `pnpm --filter @imc/api staff:grant <account> <role> "<reason>"`     | Bootstrap the first administrator (audited)                                      |
| `pnpm --filter @imc/api pilot:grant <student> <YYYY-MM-DD> <cohort>` | Expiring pilot Pro entitlement                                                   |

## Documentation

- [docs/architecture.md](docs/architecture.md): components, request path, data isolation, jobs
- [docs/decisions.md](docs/decisions.md): defaults chosen, interpretations, open questions
- [docs/openapi.json](docs/openapi.json): generated API reference
- [docs/content-import.md](docs/content-import.md): JSON import format
- [docs/requirements-checklist.md](docs/requirements-checklist.md): spec requirement → test
- [docs/security-privacy.md](docs/security-privacy.md): security checklist and retention defaults
- [docs/runbooks/](docs/runbooks): operations runbooks
- [docs/milestones.md](docs/milestones.md): milestone reports and remaining integration work

## Mocks (explicit, never production)

| Adapter        | Local driver                                     | Production driver        | Guard                                 |
| -------------- | ------------------------------------------------ | ------------------------ | ------------------------------------- |
| Object storage | `STORAGE_DRIVER=local` (disk + HMAC-signed URLs) | `supabase`               | refused when `ENVIRONMENT=production` |
| Billing        | `BILLING_DRIVER=mock` (simulated provider state) | `revenuecat`             | refused when `ENVIRONMENT=production` |
| Email          | `EMAIL_DRIVER=log` (redacted log line)           | provider adapter pending | see decisions D-016                   |
| Auth admin     | mock (records deletions)                         | Supabase admin API       | selected with Supabase storage        |

Scoring, authorization and entitlements are real in every environment. Only external providers
are mocked.
