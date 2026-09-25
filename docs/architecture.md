# Architecture

## Components

```
 iOS/Android app (Expo) ──┐                      ┌── Supabase Auth (adult/staff identity only)
                           ├── HTTPS /v1 ──► API ─┤
 Staff website (Vite) ─────┘   (Fastify)          ├── PostgreSQL (app + private schemas, RLS)
                                    ▲             ├── Private object storage (signed URLs)
 RevenueCat webhooks ── /webhooks ──┘             └── Billing provider (RevenueCat, paid gate)
                                               Worker ── same domain services, outbox_jobs
```

- **API** (`apps/api`): authenticates the principal, validates the request with zod, opens one
  transaction with transaction-local principal settings, calls a domain service and returns a
  response validated by its zod schema (unknown keys stripped, strict DTOs reject leaks).
- **Worker** (`apps/worker`): claims `outbox_jobs` with `FOR UPDATE SKIP LOCKED` and a lease,
  runs idempotent handlers, retries with exponential backoff (30 s … 1 h), dead-letters after 8
  attempts with an ops alert. Schedules hourly billing sweeps, daily purges and weekly summaries.
- **Domain** (`packages/domain`): business rules for identity, accounts, content, practice,
  progress, billing and operations; adapter ports for storage, billing, email and auth admin.
- **DB** (`packages/db`): SQL migrations, RLS policies and parameterized queries. No dynamic SQL
  interpolation of user input anywhere.

## Request path

1. `Authorization: Bearer <token>`: a JWT is verified (signature, issuer, audience, expiry) with
   `jose`; anything else is treated as an opaque child token, hashed and resolved via
   `app.resolve_child_session` (revoked/expired/deleting → 401).
2. Route auth mode decides which principals may call it (`child`, `adult`, `staff`,
   `childOrAdult`, `none`). Staff roles are re-read from `app.staff_roles` on every request;
   inactive roles/accounts are rejected; MFA (`aal2`) is required when `STAFF_REQUIRE_MFA` is on
   (always in production).
3. `withTx(pool, principal, fn)`: `BEGIN`, `set_config(..., true)` ×3, domain call, `COMMIT`.
   Serialization failures/deadlocks are retried up to 3 times.
4. Idempotent routes claim `(principal, route, key)` inside the same transaction; a concurrent
   duplicate blocks on the unique index and then replays the stored response; a different body
   with the same key is 409.
5. Errors use the envelope `{"error":{"code","message"},"requestId"}`; SQL, tokens and stack
   traces are never returned. Logs redact authorization headers, grants and signed-URL signatures.

## Data isolation

- Schemas: `app` (application tables, usage granted to `imc_api`) and `private` (answer keys,
  migration bookkeeping; no grant to `imc_api`). Supabase `anon`/`authenticated` roles have no
  access to either schema.
- RLS is enabled and **forced** on every `app` table (tested in `packages/db/test/migrate.test.ts`).
- `app.can_access_student(id)`: child → own id; adult → live `guardian_links` row; system → all.
  Staff have no path to student records.
- SECURITY DEFINER functions fix `search_path`, qualify relations, revoke `PUBLIC` execute,
  and recheck ownership: `grade_item`, `revealed_answer_key`, `staff_answer_key`,
  `staff_set_answer_key`, `resolve_child_session`, `has_staff_role`, `enqueue_job`.
- Immutability: attempts, reward events and audit events reject `UPDATE`; published/retired
  versions and their localizations/keys reject content changes (triggers).

## Practice flow

1. `POST /v1/students/:id/sessions` (child, Idempotency-Key required): per-child advisory lock,
   return an existing daily/active session, else select questions (published, rights cleared,
   grade + locale; 2 easy / 2 medium / 1 harder; topic spread; avoid the last 7 days; relax
   difficulty then recency; never rights/state). Persist version ids and shuffled choice order.
   Fewer than five eligible → `503 CONTENT_UNAVAILABLE` + ops alert, no padding.
2. `GET /v1/sessions/:sid/items/:iid`: safe DTO built field by field. Unanswered items carry no
   key, correctness, explanation or solution assets (strict schema + tests).
3. `POST …/answer`: lock session and item; same option replays; different option → 409
   `ANSWER_ALREADY_SUBMITTED`; grade via `app.grade_item`; insert immutable attempt; update
   review queue; on the final item complete the session, insert rewards (unique) and outbox jobs,
   all in one transaction.

## Content workflow

`draft → in_review → approved → published → retired`. Reviewer ≠ author. Approval records the
content hash; publication recomputes it and runs the publication validator (four distinct
choices, one valid key, English content, verified assets with alt text, cleared rights).
Corrections are new versions. Imports create drafts only.

## Billing (paid gate)

Purchase intent (fresh grant) binds adult + child + product → native store purchase with
`appUserID = billingCustomerId` → backend verifies provider state (restore or webhook job) →
binds the verified subscription to exactly one pending intent → entitlement for that child.
Unmatched/ambiguous purchases stay pending with an ops alert. A transaction already bound to
another account is never reassigned. Webhooks: `Authorization` check, unique event id stored
before acknowledgement, durable job, full-state reconciliation (duplicates and out-of-order
events converge). An hourly sweep repairs missed events. Provider outage: stored entitlements
are honoured until their stored expiry; new grants fail closed.
