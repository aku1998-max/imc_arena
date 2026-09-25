# Security checklist and data retention

## Security checklist (spec §16)

| Item                                                         | State                                                                                                                                                                                        |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff MFA                                                    | Enforced via `aal2` claim when `STAFF_REQUIRE_MFA=true`; always on in production config. Enable TOTP MFA for staff in Supabase before production.                                            |
| Rate-limited OTP and child-token creation                    | OTP: Supabase Auth limits (configure per project). Child sessions: 10/hour/adult. Grants: 10/15 min. Reports: 10/hour. Global 600/min/IP.                                                    |
| Explicit CORS for admin                                      | Only `ALLOWED_ADMIN_ORIGINS`; native apps need no CORS.                                                                                                                                      |
| Cookies/CSRF                                                 | Not used: bearer tokens only.                                                                                                                                                                |
| TLS                                                          | Terminate at the hosting edge; production config requires an `https://` API base URL.                                                                                                        |
| Request-size limits                                          | 2 MB JSON body; 1000-char reports; 500-question imports; 2 MB images.                                                                                                                        |
| Allowlisted content                                          | Zod block schema; no HTML; KaTeX with `trust: false`; image signature check.                                                                                                                 |
| No dynamic SQL interpolation                                 | All queries parameterized; identifiers in bootstrap are validated against `^[a-z_][a-z0-9_]*$`.                                                                                              |
| Signed media URLs                                            | 300 s; solution assets only after an attempt.                                                                                                                                                |
| Secret scanning / dependency review                          | Enable GitHub secret scanning + push protection; CI runs `dependency-review-action` on PRs once the Dependency graph is enabled and the repository variable `DEPENDENCY_REVIEW=true` is set. |
| Native tokens in secure storage                              | Child token and adult session in Keychain/Keystore (`expo-secure-store`, chunked).                                                                                                           |
| Separate migration/runtime accounts                          | `imc_owner` vs `imc_api`; enforced by bootstrap and tests.                                                                                                                                   |
| Support impersonation                                        | Not implemented (disabled in V1).                                                                                                                                                            |
| Export/deletion prove guardianship + grant scope server-side | RLS + single-use action/target grants; tested.                                                                                                                                               |
| Logs                                                         | Request id + redacted actor; never bearer tokens, grants, OTPs, bodies or full question payloads.                                                                                            |
| Production admin login does not reuse dev privileges         | Dev tokens require `AUTH_JWT_SECRET` (HS256) which production refuses; staff roles are per-environment records.                                                                              |

## Data minimization

Children: nickname, avatar key, grade, locale, IANA timezone. No legal name, birthdate, school,
location, contacts, advertising SDK, chat or public profile. Adults: Auth subject id; email stays
in Supabase Auth and is fetched on demand for notifications. Android location, contacts, camera
and microphone permissions are blocked in `app.json`.

## Proposed retention defaults (need owner approval; not legal advice)

| Data                          | Implementation                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Child sessions / adult grants | Expire (7 days / 5 minutes); purged 30 days after expiry/revocation (`maintenance.purge`).                                     |
| Idempotency keys              | 24 hours; permanent uniqueness on attempts, rewards, billing events remains.                                                   |
| Operational logs              | 30 days at the log provider, access restricted (configure in hosting).                                                         |
| Practice history              | Kept while the account is active; deletion removes the child row and all cascaded history, reports and analytics subject rows. |
| Exports                       | Private object, 5-minute download links, purged after 7 days (`export.purge`).                                                 |
| Billing / audit               | Separate schedule required before paid launch. Audit rows store ids and redacted metadata only.                                |

Before production: confirm child-consent requirements, privacy notices and store rules for the
launch markets, and identify records that must be retained (purpose, duration).
