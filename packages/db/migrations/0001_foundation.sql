-- IMC Arena foundation: schemas, request-context helpers and shared triggers.
-- Runs as the migration/owner role (imc_owner). The runtime role imc_api must already exist
-- (see scripts/bootstrap.ts or docs/runbooks/database-roles.md).

create schema if not exists app;
create schema if not exists private;

revoke all on schema app from public;
revoke all on schema private from public;
grant usage on schema app to imc_api;
-- imc_api gets no usage on the private schema: answer keys are reachable only through
-- narrowly scoped SECURITY DEFINER functions in the app schema.

-- Supabase exposes anon/authenticated roles through its Data API. Application data is API-only,
-- so remove any access those roles could have to our schemas when they exist.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema app from %I', r);
      execute format('revoke all on schema private from %I', r);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Transaction-local request context. The API sets these with set_config(..., true)
-- inside each request transaction. Missing context denies access.
-- ---------------------------------------------------------------------------

create function app.ctx_type() returns text
language sql stable
as $$ select nullif(current_setting('app.principal_type', true), '') $$;

create function app.ctx_account() returns uuid
language sql stable
as $$ select nullif(current_setting('app.account_id', true), '')::uuid $$;

create function app.ctx_student() returns uuid
language sql stable
as $$ select nullif(current_setting('app.student_id', true), '')::uuid $$;

create function app.is_system() returns boolean
language sql stable
as $$ select coalesce(app.ctx_type() = 'system', false) $$;

create function app.has_context() returns boolean
language sql stable
as $$ select app.ctx_type() in ('child', 'adult', 'staff', 'system') $$;

create function app.touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function app.reject_mutation() returns trigger
language plpgsql
as $$
begin
  raise exception '% on % is not permitted (append-only/immutable)', tg_op, tg_table_name
    using errcode = '42501';
end $$;

-- Migration bookkeeping lives in private, invisible to the runtime role.
create table if not exists private.schema_migrations (
  name text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);
