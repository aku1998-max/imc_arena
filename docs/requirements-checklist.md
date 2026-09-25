# Requirements-to-tests checklist

Spec section → where it is enforced → automated evidence. `api:` = `apps/api/test/*.test.ts`
(real PostgreSQL, real roles), `e2e:` = `apps/admin/e2e`, `unit:` = package unit tests.
"Device" rows need the native device test plan below; they cannot run in CI.

## §17 acceptance tests

| Acceptance test                                                                                     | Evidence                                                                                                                                                                                                               | Status                              |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Family isolation: A cannot fetch/modify/export/delete B by changing ids                             | api: isolation › _parent A cannot read, modify, export or delete family B_; _child A cannot use family B practice routes_; runtime-role suite (_adult context sees only linked children_, _context cannot be spoofed_) | ✅                                  |
| Child scope: child token cannot call guardian/staff/billing or another child's practice             | api: isolation › _child token cannot call guardian, staff or billing APIs_                                                                                                                                             | ✅                                  |
| Answer secrecy: unanswered DTOs and media links contain no key/correctness/solution                 | api: practice › _unanswered DTOs and media links carry no key…_; unit: contracts › _safe question DTO_; api: content › solution image only signed in staff view/after answer                                           | ✅                                  |
| Retry safety: concurrent identical submissions → one attempt/completion/reward                      | api: practice › _concurrent identical submissions create one attempt, one completion and one reward_                                                                                                                   | ✅                                  |
| Changed retry → 409, original preserved                                                             | api: practice › _a different option after commit returns 409…_                                                                                                                                                         | ✅                                  |
| Daily uniqueness: concurrent starts → one session; reconnect → same order                           | api: practice › _concurrent starts create one daily session…_                                                                                                                                                          | ✅                                  |
| Versioning: new publication does not alter existing session/explanation                             | api: content › _a new publication does not alter an existing session or historical explanation_                                                                                                                        | ✅                                  |
| Editorial approval: author cannot approve own; post-approval edits invalidate hash                  | api: content › _an author cannot approve their own version_; _post-approval edits return the version to draft…_; e2e: _editor drafts, another reviewer approves…_                                                      | ✅                                  |
| Billing: duplicate/out-of-order/refund events converge to provider state                            | api: billing › _authenticates, deduplicates and converges…_                                                                                                                                                            | ✅ (mock provider; sandbox pending) |
| Expiry and revocation: revoked child session fails immediately; expired paid grant cannot start Pro | api: identity › _a revoked child session fails immediately_; billing › _an expired paid grant cannot start a new Pro session…_                                                                                         | ✅                                  |
| Recovery: worker restart mid-job, lease recovery without duplicate grants                           | api: jobs › _a worker crash mid-job is recovered via lease expiry without duplicate grants_                                                                                                                            | ✅                                  |
| Deletion: tokens stop immediately; job removes private assets/history                               | api: jobs › _student deletion stops tokens immediately…_; _account deletion removes the account…_                                                                                                                      | ✅                                  |

## Other MUST rules

| Rule                                                                                                   | Evidence                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Clients never connect to tables or receive a service-role key (§03)                                    | Architecture: mobile/admin only call the API; `anon`/`authenticated` revoked in migration 0001; no service key in `EXPO_PUBLIC_*`/`VITE_*` |
| Verified JWT only (§05)                                                                                | api: identity/isolation › _rejects unsigned, wrongly signed, expired and wrong-audience JWTs_                                              |
| Child tokens ≥ 256 bits, hash only, one student/device, 7-day expiry (§05)                             | api: identity › _store only a hash of a 256-bit token…_; unit: crypto                                                                      |
| Fresh adult grant, 5 minutes, action-scoped (§05)                                                      | api: identity › _require a fresh OTP and are single-use and action/target scoped_; _expired grants are refused_                            |
| Staff roles server-controlled, inactive rejected each request, MFA (§05)                               | api: content › _inactive staff roles are rejected on every request_; identity › _requires aal2 tokens…_                                    |
| Staff content roles do not grant student access (§05)                                                  | api: isolation › _staff content roles do not grant access to student records_                                                              |
| RLS enabled and forced; runtime role not owner/superuser/BYPASSRLS; missing context denies (§08)       | unit(db): _forces row-level security on every application table_; api: _runtime role is not superuser…_; _missing context denies access_   |
| Answer keys only via scoped function (§08)                                                             | api: isolation › _answer keys are not directly readable and grading refuses foreign items_                                                 |
| Migration identity ≠ runtime identity (§04)                                                            | unit(db): _keeps the runtime identity separate…_                                                                                           |
| Exactly four distinct choices, one key among them (§06)                                                | unit: contracts › publication validator; api: content › _publication requires cleared rights, four distinct choices…_                      |
| No arbitrary HTML (§09)                                                                                | unit: contracts › _rejects html blocks and unknown fields_; api: content (html stem rejected)                                              |
| Imports only into drafts, row errors, duplicate detection (§09)                                        | api: content › _imports into drafts with per-item errors and duplicate detection_                                                          |
| MIME/size validation, no SVG/HTML (§08)                                                                | api: content › _uploads an image, verifies checksum and file signature, and refuses disguised files_                                       |
| Signed URLs expire after 5 minutes (§08)                                                               | api: jobs › _export produces a private object with a short-lived link_; content (tampered signature → 403)                                 |
| Selection: five distinct, 2/2/1 mix, avoid 7-day repeats, never pad, CONTENT_UNAVAILABLE + alert (§10) | unit: selection suite; api: practice › _selects five distinct questions…_; _returns CONTENT_UNAVAILABLE…_                                  |
| One unfinished session per mode/topic (§10)                                                            | api: practice › mistakes test (_Starting again returns the same unfinished mistakes session_)                                              |
| Timezone change cannot issue an extra daily (§10)                                                      | api: practice › _a timezone change cannot unlock an extra daily challenge…_                                                                |
| Accuracy counts first encounters; retries separate (§10)                                               | api: practice › _mistakes queue: … retries counted separately_                                                                             |
| Idempotency: same key/body replays, different body 409 (§12)                                           | api: practice › idempotency                                                                                                                |
| GET routes do not create state (§11)                                                                   | api: practice › _GET routes do not create state_                                                                                           |
| Error envelope, no SQL/tokens/stack traces (§12)                                                       | api: identity › _validation errors echo paths, not values…_                                                                                |
| Rate limits with Retry-After (§12/§16)                                                                 | api: practice › _reports are length-limited and throttled_; identity › _child-session creation is rate limited_                            |
| Client success callback alone does not authorize Pro (§14)                                             | api: billing › _a client success callback alone does not grant Pro_                                                                        |
| Same purchase cannot fund several children/families (§14)                                              | api: billing › _the entitlement belongs to the selected child only_; _the same store purchase cannot fund a second family_                 |
| Unmatched purchases stay pending (§14)                                                                 | api: billing › _an unmatched purchase stays pending…_                                                                                      |
| Provider unavailable: honour stored expiry, fail closed (§14)                                          | api: billing › _provider outage…_                                                                                                          |
| Outbox + SKIP LOCKED + lease + backoff + dead letter after 8 (§15)                                     | api: jobs › durable jobs; worker › _schedules periodic jobs once per window…_                                                              |
| Scoring pause keeps committed attempts (§18 rollback)                                                  | api: practice › _submissions can be paused without losing committed attempts_                                                              |
| Consent before child mode; withdrawal revokes (§16)                                                    | api: identity › _withdrawing core consent revokes child devices_; isolation setup requires consent                                         |
| OpenAPI current (§19 handoff)                                                                          | api: openapi › _docs/openapi.json is up to date_                                                                                           |
| Offline: never grade locally; resend with the same key; "Waiting to sync" (§13)                        | unit(mobile): _keeps the answer and its key while offline…_; _resolves a queued answer before permitting an answer to another item_        |

## Device test plan (manual / device farm, not automated here)

Run on at least one small iPhone, one large Android phone and one tablet, with large text and a
screen reader enabled for part of the run.

1. First use: welcome → email OTP → consent → child profile → child mode. Verify the adult
   session is gone (kill app, reopen → child home; _Switch to parent mode_ requires OTP).
2. Daily practice: answer 5 questions; double-tap _Check answer_ rapidly (one submission);
   feedback readable with VoiceOver/TalkBack (choices announce letter, text and result).
3. Diagram zoom: open a question with an image, pinch-zoom, close; answer controls unchanged.
4. Reconnect: enable airplane mode after selecting an answer, submit → "Waiting to sync"; restore
   network → answer graded once; points appear only after sync.
5. Revocation: from a second device revoke the child device → first device returns to sign-in on
   next request.
6. Purchase restoration (paid gate): sandbox purchase, delete app, reinstall, restore.
7. Math notation from the approved pilot bank renders on both platforms; spoken alternatives read.
