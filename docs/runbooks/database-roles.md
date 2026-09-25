# Database roles on a hosted PostgreSQL (e.g. Supabase)

Locally, `pnpm db:bootstrap` creates the roles with a superuser. On a hosted database, run the
equivalent once with the project's admin connection (SQL editor), using secrets from the secret
manager:

```sql
create role imc_owner login password '<owner-secret>' nosuperuser bypassrls nocreatedb nocreaterole;
create role imc_api   login password '<runtime-secret>' nosuperuser nobypassrls nocreatedb nocreaterole;
grant create on database postgres to imc_owner;   -- lets the owner create the app/private schemas
grant connect on database postgres to imc_api;
```

Then set `DATABASE_MIGRATION_URL` (imc_owner) for the migration job and `DATABASE_URL`
(imc_api) for the API/worker, and run `pnpm db:migrate`. The migrations revoke Supabase
`anon`/`authenticated` access to the `app` and `private` schemas; do not add those schemas to
the Data API's exposed schemas. Use the session-mode pooler or direct connections: the API uses
transaction-local settings only (`set_config(..., true)`), never session-wide `SET`.
