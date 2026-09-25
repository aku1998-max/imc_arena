# Milestone report

Status of spec §19 milestones in this repository (25 September 2026).

| Milestone            | Status                                                 | Exit gate evidence                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 Foundation        | ✅ Done                                                | Clean setup: `pnpm install`, `db:bootstrap`, `db:migrate` (idempotent), `db:seed`; CI workflow; `.env.example`; original synthetic fixtures                                                                                             |
| M1 Identity          | ✅ Done                                                | Adult JWT verification, guardian links, child-token exchange/revocation, scoped DB access; isolation suite passes over HTTP and the runtime DB role                                                                                     |
| M2 Content           | ✅ Done                                                | Admin draft editor, JSON import validation, independent review, publication, private assets; versioning tests + Playwright publication flow pass                                                                                        |
| M3 Practice          | ✅ Done                                                | Selection, safe DTO, scoring transaction, resume, mistakes, basic progress; retry tests pass                                                                                                                                            |
| M4 Pilot UX          | ◐ Code complete; device walkthrough pending            | Mobile navigation, parent summary, accessibility labels, analytics events, support reports, structured logging; typechecks, unit tests and Metro bundling pass. The exit gate needs the device walkthrough in requirements-checklist.md |
| M5 Paid gate         | ◐ Backend complete with explicit mock; sandbox pending | Provider adapter, purchase intents, verified entitlements, webhook reconciliation, sweep; billing tests pass against the mock provider. Needs RevenueCat sandbox + native SDK (paid-gate.md)                                            |
| M6 Release readiness | ◐ Documentation complete; owner actions pending        | Runbooks, backup drill, cohort flags, deployment plan, security checklist. Needs owner approval for hosting, staff MFA, secrets and production actions                                                                                  |

## Commands run and results (local, PostgreSQL 16, Node 22)

| Command                              | Result                                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                     | all 9 packages clean                                                                                                        |
| `pnpm format:check`                  | clean                                                                                                                       |
| `pnpm db:reset`                      | 5 migrations applied; seed imported 158 original questions, published g4=53, g5=52, g6=53 through import → review → publish |
| `pnpm test`                          | contracts 9, db 3, domain 11, testing 2, worker 2, mobile 7, api 69, total 103 passing                                      |
| `pnpm --filter @imc/admin e2e`       | 2 passing (Chromium): editor → reviewer → administrator publication; validation error display                               |
| `npx expo export --platform android` | Hermes bundle built (monorepo resolution OK)                                                                                |
| `pnpm openapi`                       | `docs/openapi.json` regenerated; CI checks it is current                                                                    |
| Manual smoke (curl)                  | parent → consent → child session → daily start → safe item → answer → 409 on changed answer → parent home                   |

## What remains for integration (needs credentials or owner authorization)

1. **Supabase projects** (staging/production): create roles (runbooks/database-roles.md), set
   `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, storage bucket + server credential; configure
   OTP email templates and rate limits; enable staff TOTP MFA.
2. **Verify Supabase Storage REST endpoints** used by `SupabaseStorage` and the auth admin calls
   against the project's API version (decisions D-012).
3. **Email provider adapter** for parent summaries and deletion notices (D-016); reminders stay off
   until then.
4. **Native builds and device testing** (EAS or local Xcode/Android Studio), including the device
   test plan and math notation from the approved pilot bank (D-024).
5. **Paid gate**: RevenueCat sandbox, `react-native-purchases`, mapping verification (D-015),
   store products, sandbox test matrix (runbooks/paid-gate.md).
6. **Hosting**: API + worker deployment, static admin hosting, TLS, log retention (30 days),
   alert routing for `ops_alerts`, error rate and job failures; backup drill.
7. **Content**: approved and rights-cleared pilot bank to replace the synthetic questions.
8. Shared rate-limit store before running more than one API instance (D-018).

## Deferred by scope (spec §01): not built

Live battles, public rankings, chat, AI tutoring or generation, official exam delivery, school
tenancy, historical award imports, family plans, support impersonation, self-service
subscription transfers.
