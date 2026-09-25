# Deployment, rollout and rollback

## Environments

|          | Local                        | Staging                   | Production                        |
| -------- | ---------------------------- | ------------------------- | --------------------------------- |
| Database | local PostgreSQL             | isolated Supabase project | separate Supabase project         |
| Auth     | dev tokens / local Supabase  | Supabase OTP              | Supabase OTP, staff MFA           |
| Storage  | `local` mock                 | Supabase private bucket   | Supabase private bucket           |
| Billing  | `mock`                       | RevenueCat sandbox        | RevenueCat production (paid gate) |
| Secrets  | `.env` (non-secret defaults) | secret manager            | secret manager, restricted staff  |

Deploy one API service and one worker in the database region; serve `apps/admin/dist` from static
hosting. No Redis, microservices or real-time transport.

Builds: `pnpm --filter @imc/api build` and `pnpm --filter @imc/worker build` produce
`dist/server.js` / `dist/main.js` with the workspace packages compiled in; third-party packages
stay external, so the runtime image needs production dependencies installed
(`pnpm deploy --filter @imc/api --prod <dir>`). Run `pnpm db:migrate` as a separate, reviewed
release step with the migration identity, never from the API process.

## CI/CD gates (`.github/workflows/ci.yml`)

Formatting, type checks, migrations against a clean database (twice, second is a no-op), seed,
unit + integration tests, OpenAPI freshness, production builds, admin Playwright tests, mobile
bundle check, dependency review. Migrations must also be rehearsed on a staging snapshot without
live personal data. **Destructive production migrations never run automatically.**

## Rollout sequence (spec §18)

1. Staff-only content operations. 2. Internal test families + synthetic questions.
2. Invited school cohort with pilot entitlements (`pilot:grant`). 4. Fix observed issues.
3. Paid continuation after provider and store gates (paid-gate.md).

Independent flags (`app.feature_flags`): `billing`, `reminders`, `new_sessions`,
`answer_submissions`.

## Rollback

- Prefer additive migrations compatible with the previous API build; keep the previous build
  deployable.
- Scoring failure: `answer_submissions=false` (clear message, committed attempts preserved).
- Defective content: retire it from selection.
- Billing failure: `billing=false` pauses new purchase initiation; existing entitlements keep
  their stored expiry; reconcile afterwards.
