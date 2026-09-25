-- Accounts, child profiles, guardianship, consent, child sessions, adult grants, staff roles.

create table app.accounts (
  id uuid primary key, -- equals the verified Auth subject
  status text not null default 'active' check (status in ('active', 'deleting', 'closed')),
  preferred_locale text not null default 'en',
  billing_customer_id text not null unique default ('bc_' || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger accounts_touch before update on app.accounts
  for each row execute function app.touch_updated_at();

create table app.students (
  id uuid primary key default gen_random_uuid(),
  nickname text not null check (char_length(nickname) between 1 and 24),
  avatar_key text not null,
  grade smallint not null check (grade between 4 and 6),
  locale text not null default 'en',
  timezone text not null,
  status text not null default 'active' check (status in ('active', 'deleting')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger students_touch before update on app.students
  for each row execute function app.touch_updated_at();

create table app.guardian_links (
  account_id uuid not null references app.accounts (id) on delete cascade,
  student_id uuid not null references app.students (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner')),
  created_at timestamptz not null default now(),
  primary key (account_id, student_id)
);
-- One owner per child in V1. This also stops another adult from attaching to an existing child.
create unique index guardian_links_one_owner on app.guardian_links (student_id) where role = 'owner';
create index guardian_links_account_student on app.guardian_links (account_id, student_id);

-- Access predicate for student-owned records.
create function app.can_access_student(sid uuid) returns boolean
language sql stable
as $$
  select case app.ctx_type()
    when 'child' then sid = app.ctx_student()
    when 'adult' then exists (
      select 1 from app.guardian_links g
      where g.student_id = sid and g.account_id = app.ctx_account()
    )
    when 'system' then true
    else false
  end
$$;

create function app.is_guardian_of(sid uuid) returns boolean
language sql stable
as $$
  select app.ctx_type() = 'adult' and exists (
    select 1 from app.guardian_links g
    where g.student_id = sid and g.account_id = app.ctx_account()
  )
$$;

create table app.consent_records (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references app.accounts (id) on delete cascade,
  student_id uuid not null references app.students (id) on delete cascade,
  purpose text not null check (purpose in ('core_service', 'parent_reminders', 'product_analytics')),
  policy_version text not null,
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  created_at timestamptz not null default now()
);
create index consent_records_student on app.consent_records (student_id, purpose, granted_at desc);

create table app.child_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app.students (id) on delete cascade,
  created_by uuid not null references app.accounts (id) on delete cascade,
  token_hash text not null unique,
  device_label text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index child_sessions_student on app.child_sessions (student_id, created_at desc);

create table app.adult_action_grants (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references app.accounts (id) on delete cascade,
  token_hash text not null unique,
  action text not null,
  target_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table app.staff_roles (
  account_id uuid not null references app.accounts (id) on delete cascade,
  role text not null check (role in ('editor', 'reviewer', 'administrator', 'support')),
  permission_scope text not null default 'global',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, role)
);
create trigger staff_roles_touch before update on app.staff_roles
  for each row execute function app.touch_updated_at();

-- SECURITY DEFINER so that policies on staff_roles itself can call it without recursion.
-- It only answers a yes/no question about the current principal.
create function app.has_staff_role(p_role text default null) returns boolean
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select app.ctx_type() = 'staff' and exists (
    select 1 from app.staff_roles r
    join app.accounts a on a.id = r.account_id
    where r.account_id = app.ctx_account()
      and r.active
      and a.status = 'active'
      and (p_role is null or r.role = p_role)
  )
$$;
revoke all on function app.has_staff_role(text) from public;
grant execute on function app.has_staff_role(text) to imc_api;

-- Resolves an opaque child token hash before any principal context exists. Returns nothing for
-- unknown, revoked or expired sessions, or for students being deleted.
create function app.resolve_child_session(p_token_hash text)
returns table (session_id uuid, student_id uuid, expires_at timestamptz)
language sql stable security definer
set search_path = pg_catalog, app
as $$
  select cs.id, cs.student_id, cs.expires_at
  from app.child_sessions cs
  join app.students s on s.id = cs.student_id
  where cs.token_hash = p_token_hash
    and cs.revoked_at is null
    and cs.expires_at > now()
    and s.status = 'active'
$$;
revoke all on function app.resolve_child_session(text) from public;
grant execute on function app.resolve_child_session(text) to imc_api;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table app.accounts enable row level security;
alter table app.accounts force row level security;
create policy accounts_select on app.accounts for select
  using (id = app.ctx_account() and app.ctx_type() in ('adult', 'staff') or app.is_system());
create policy accounts_insert on app.accounts for insert
  with check (id = app.ctx_account() and app.ctx_type() in ('adult', 'staff') or app.is_system());
create policy accounts_update on app.accounts for update
  using (id = app.ctx_account() and app.ctx_type() = 'adult' or app.is_system());
create policy accounts_delete on app.accounts for delete using (app.is_system());

alter table app.students enable row level security;
alter table app.students force row level security;
create policy students_select on app.students for select using (app.can_access_student(id));
create policy students_insert on app.students for insert
  with check (app.ctx_type() = 'adult' or app.is_system());
create policy students_update on app.students for update
  using (app.is_guardian_of(id) or app.is_system());
create policy students_delete on app.students for delete using (app.is_system());

alter table app.guardian_links enable row level security;
alter table app.guardian_links force row level security;
create policy guardian_links_select on app.guardian_links for select
  using (account_id = app.ctx_account() and app.ctx_type() = 'adult' or app.is_system());
create policy guardian_links_insert on app.guardian_links for insert
  with check (account_id = app.ctx_account() and app.ctx_type() = 'adult' or app.is_system());
create policy guardian_links_delete on app.guardian_links for delete using (app.is_system());

alter table app.consent_records enable row level security;
alter table app.consent_records force row level security;
create policy consent_select on app.consent_records for select
  using (account_id = app.ctx_account() and app.is_guardian_of(student_id) or app.is_system());
create policy consent_insert on app.consent_records for insert
  with check (account_id = app.ctx_account() and app.is_guardian_of(student_id));
create policy consent_update on app.consent_records for update
  using (account_id = app.ctx_account() and app.is_guardian_of(student_id));
create policy consent_delete on app.consent_records for delete using (app.is_system());

alter table app.child_sessions enable row level security;
alter table app.child_sessions force row level security;
create policy child_sessions_select on app.child_sessions for select
  using (app.is_guardian_of(student_id) or app.is_system()
         or (app.ctx_type() = 'child' and student_id = app.ctx_student()));
create policy child_sessions_insert on app.child_sessions for insert
  with check (app.is_guardian_of(student_id) and created_by = app.ctx_account());
create policy child_sessions_update on app.child_sessions for update
  using (app.is_guardian_of(student_id) or app.is_system()
         or (app.ctx_type() = 'child' and student_id = app.ctx_student()));
create policy child_sessions_delete on app.child_sessions for delete using (app.is_system());

alter table app.adult_action_grants enable row level security;
alter table app.adult_action_grants force row level security;
create policy grants_all on app.adult_action_grants for all
  using (account_id = app.ctx_account() and app.ctx_type() = 'adult' or app.is_system())
  with check (account_id = app.ctx_account() and app.ctx_type() = 'adult' or app.is_system());

alter table app.staff_roles enable row level security;
alter table app.staff_roles force row level security;
create policy staff_roles_select on app.staff_roles for select
  using (account_id = app.ctx_account() or app.has_staff_role('administrator') or app.is_system());
create policy staff_roles_write on app.staff_roles for all
  using (app.has_staff_role('administrator') or app.is_system())
  with check (app.has_staff_role('administrator') or app.is_system());

grant select, insert, update, delete on
  app.accounts, app.students, app.guardian_links, app.consent_records,
  app.child_sessions, app.adult_action_grants, app.staff_roles
to imc_api;
