-- Billing, entitlements, idempotency, jobs, support, audit, analytics and data-rights workflows.

create table app.subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references app.accounts (id) on delete cascade,
  provider text not null default 'revenuecat',
  provider_customer_id text not null,
  original_transaction_id text not null,
  product_id text not null,
  status text not null check (status in ('active', 'trial', 'cancelled', 'grace', 'billing_issue', 'expired', 'revoked', 'refunded')),
  expires_at timestamptz,
  grace_expires_at timestamptz,
  last_verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The same store purchase can never fund more than one binding.
  unique (provider, original_transaction_id)
);
create trigger subscriptions_touch before update on app.subscriptions
  for each row execute function app.touch_updated_at();

create table app.purchase_intents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references app.accounts (id) on delete cascade,
  student_id uuid not null references app.students (id) on delete cascade,
  product_id text not null,
  status text not null default 'pending' check (status in ('pending', 'bound', 'expired', 'ambiguous')),
  subscription_id uuid references app.subscriptions (id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index purchase_intents_account on app.purchase_intents (account_id, created_at desc);
create trigger purchase_intents_touch before update on app.purchase_intents
  for each row execute function app.touch_updated_at();

create table app.entitlements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references app.accounts (id) on delete cascade,
  student_id uuid not null references app.students (id) on delete cascade,
  feature_set text not null default 'pro',
  source text not null check (source in ('purchase', 'pilot', 'support')),
  source_id text not null,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id, student_id)
);
create index entitlements_student_valid on app.entitlements (student_id, valid_until);
create trigger entitlements_touch before update on app.entitlements
  for each row execute function app.touch_updated_at();

create table app.billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  app_user_id text,
  payload_hash text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processed', 'failed', 'ignored')),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);

create table app.idempotency_keys (
  principal_id uuid not null,
  route text not null,
  key text not null,
  request_hash text not null,
  status_code int,
  response_json jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (principal_id, route, key)
);
create index idempotency_keys_expiry on app.idempotency_keys (expires_at);

create table app.outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null default now(),
  lease_until timestamptz,
  attempts int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'dead')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index outbox_jobs_status_run_at on app.outbox_jobs (status, run_at);
create trigger outbox_jobs_touch before update on app.outbox_jobs
  for each row execute function app.touch_updated_at();

create table app.support_reports (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references app.students (id) on delete set null,
  account_id uuid references app.accounts (id) on delete set null,
  version_id uuid references app.question_versions (id),
  category text not null,
  message text check (message is null or char_length(message) <= 1000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'dismissed')),
  assigned_to uuid references app.accounts (id),
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_reports_status on app.support_reports (status, created_at desc);
create trigger support_reports_touch before update on app.support_reports
  for each row execute function app.touch_updated_at();

create table app.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  target_type text not null,
  target_id text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index audit_events_target on app.audit_events (target_type, target_id, occurred_at desc);
create index audit_events_occurred on app.audit_events (occurred_at desc, id desc);
create trigger audit_events_append_only before update or delete on app.audit_events
  for each row execute function app.reject_mutation();

create table app.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references app.accounts (id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  consent_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table app.data_exports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references app.accounts (id) on delete cascade,
  student_id uuid not null references app.students (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed', 'expired')),
  object_key text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger data_exports_touch before update on app.data_exports
  for each row execute function app.touch_updated_at();

create table app.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  scope text not null check (scope in ('student', 'account')),
  target_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger deletion_requests_touch before update on app.deletion_requests
  for each row execute function app.touch_updated_at();

create table app.analytics_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject_id uuid,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index analytics_events_name_time on app.analytics_events (name, occurred_at);

create table app.ops_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  dedupe_key text not null unique,
  details jsonb not null default '{}'::jsonb,
  occurrences int not null default 1,
  last_seen_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create table app.feature_flags (
  key text primary key,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
insert into app.feature_flags (key, enabled) values
  ('billing', false),
  ('reminders', false),
  ('new_sessions', true),
  ('answer_submissions', true);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table app.subscriptions enable row level security;
alter table app.subscriptions force row level security;
create policy subscriptions_select on app.subscriptions for select
  using (account_id = app.ctx_account() and app.ctx_type() = 'adult' or app.is_system());
create policy subscriptions_write on app.subscriptions for all
  using (app.is_system()) with check (app.is_system());

alter table app.purchase_intents enable row level security;
alter table app.purchase_intents force row level security;
create policy intents_select on app.purchase_intents for select
  using (account_id = app.ctx_account() and app.ctx_type() = 'adult' or app.is_system());
create policy intents_insert on app.purchase_intents for insert
  with check (account_id = app.ctx_account() and app.is_guardian_of(student_id));
create policy intents_update on app.purchase_intents for update using (app.is_system());

alter table app.entitlements enable row level security;
alter table app.entitlements force row level security;
create policy entitlements_select on app.entitlements for select
  using (account_id = app.ctx_account() and app.is_guardian_of(student_id)
         or app.ctx_type() = 'child' and student_id = app.ctx_student()
         or app.is_system());
create policy entitlements_write on app.entitlements for all
  using (app.is_system()) with check (app.is_system());

alter table app.billing_events enable row level security;
alter table app.billing_events force row level security;
create policy billing_events_all on app.billing_events for all
  using (app.is_system()) with check (app.is_system());

alter table app.idempotency_keys enable row level security;
alter table app.idempotency_keys force row level security;
create policy idempotency_all on app.idempotency_keys for all
  using (principal_id = coalesce(app.ctx_student(), app.ctx_account()) or app.is_system())
  with check (principal_id = coalesce(app.ctx_student(), app.ctx_account()) or app.is_system());

alter table app.outbox_jobs enable row level security;
alter table app.outbox_jobs force row level security;
create policy jobs_insert on app.outbox_jobs for insert with check (app.has_context());
create policy jobs_system on app.outbox_jobs for all
  using (app.is_system()) with check (app.is_system());
create policy jobs_staff_read on app.outbox_jobs for select
  using (app.has_staff_role('administrator'));

alter table app.support_reports enable row level security;
alter table app.support_reports force row level security;
create policy reports_insert on app.support_reports for insert
  with check (
    app.ctx_type() = 'child' and student_id = app.ctx_student() and account_id is null
    or app.ctx_type() = 'adult' and account_id = app.ctx_account()
       and (student_id is null or app.is_guardian_of(student_id))
  );
create policy reports_staff on app.support_reports for select
  using (app.has_staff_role() or app.is_system());
create policy reports_staff_update on app.support_reports for update
  using (app.has_staff_role('support') or app.has_staff_role('administrator')
         or app.has_staff_role('editor'));
create policy reports_delete on app.support_reports for delete using (app.is_system());

alter table app.audit_events enable row level security;
alter table app.audit_events force row level security;
create policy audit_insert on app.audit_events for insert with check (app.has_context());
create policy audit_select on app.audit_events for select
  using (app.has_staff_role('administrator') or app.has_staff_role('support') or app.is_system());

alter table app.device_push_tokens enable row level security;
alter table app.device_push_tokens force row level security;
create policy push_all on app.device_push_tokens for all
  using (account_id = app.ctx_account() and app.ctx_type() = 'adult' or app.is_system())
  with check (account_id = app.ctx_account() and app.ctx_type() = 'adult' or app.is_system());

alter table app.data_exports enable row level security;
alter table app.data_exports force row level security;
create policy exports_select on app.data_exports for select
  using (account_id = app.ctx_account() and app.is_guardian_of(student_id) or app.is_system());
create policy exports_insert on app.data_exports for insert
  with check (account_id = app.ctx_account() and app.is_guardian_of(student_id));
create policy exports_system on app.data_exports for update using (app.is_system());
create policy exports_delete on app.data_exports for delete using (app.is_system());

alter table app.deletion_requests enable row level security;
alter table app.deletion_requests force row level security;
create policy deletion_select on app.deletion_requests for select
  using (account_id = app.ctx_account() and app.ctx_type() = 'adult' or app.is_system());
create policy deletion_insert on app.deletion_requests for insert
  with check (account_id = app.ctx_account() and app.ctx_type() = 'adult'
              and (scope = 'account' and target_id = app.ctx_account()
                   or scope = 'student' and app.is_guardian_of(target_id)));
create policy deletion_update on app.deletion_requests for update using (app.is_system());

alter table app.analytics_events enable row level security;
alter table app.analytics_events force row level security;
create policy analytics_insert on app.analytics_events for insert with check (app.has_context());
create policy analytics_select on app.analytics_events for select
  using (app.has_staff_role('administrator') or app.is_system());
create policy analytics_delete on app.analytics_events for delete using (app.is_system());

alter table app.ops_alerts enable row level security;
alter table app.ops_alerts force row level security;
create policy alerts_insert on app.ops_alerts for insert with check (app.has_context());
create policy alerts_update on app.ops_alerts for update using (app.has_context());
create policy alerts_select on app.ops_alerts for select
  using (app.has_context());

alter table app.feature_flags enable row level security;
alter table app.feature_flags force row level security;
create policy flags_select on app.feature_flags for select using (app.has_context());
create policy flags_write on app.feature_flags for update
  using (app.has_staff_role('administrator') or app.is_system());

grant select, insert, update, delete on
  app.subscriptions, app.purchase_intents, app.entitlements, app.billing_events,
  app.idempotency_keys, app.outbox_jobs, app.support_reports, app.device_push_tokens,
  app.data_exports, app.deletion_requests, app.analytics_events, app.ops_alerts
to imc_api;
grant select, insert on app.audit_events to imc_api;
grant select, update on app.feature_flags to imc_api;

-- Any authenticated context may enqueue work, but only the system (worker) may read jobs.
-- INSERT ... ON CONFLICT checks SELECT policies, so deduplicated enqueue goes through this
-- narrowly scoped function instead of a broader SELECT policy.
create function app.enqueue_job(p_type text, p_dedupe_key text, p_payload jsonb, p_run_at timestamptz)
returns boolean
language plpgsql volatile security definer
set search_path = pg_catalog, app
as $$
declare v_count int;
begin
  if not app.has_context() then
    raise exception 'enqueue requires a principal context' using errcode = '42501';
  end if;
  insert into app.outbox_jobs (type, dedupe_key, payload, run_at)
  values (p_type, p_dedupe_key, coalesce(p_payload, '{}'::jsonb), coalesce(p_run_at, now()))
  on conflict (dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count = 1;
end $$;
revoke all on function app.enqueue_job(text, text, jsonb, timestamptz) from public;
grant execute on function app.enqueue_job(text, text, jsonb, timestamptz) to imc_api;
