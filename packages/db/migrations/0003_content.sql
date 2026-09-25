-- Versioned question content, private answer keys, assets, reviews and imports.

create table app.topics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,64}$'),
  display_key text not null,
  parent_id uuid references app.topics (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger topics_touch before update on app.topics
  for each row execute function app.touch_updated_at();

create table app.questions (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('original', 'licensed', 'imc_archive')),
  source_reference text,
  rights_status text not null default 'unknown' check (rights_status in ('unknown', 'cleared', 'restricted')),
  rights_notes text,
  active_version_id uuid,
  created_by uuid not null references app.accounts (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index questions_source_reference on app.questions (source_type, source_reference)
  where source_reference is not null;
create trigger questions_touch before update on app.questions
  for each row execute function app.touch_updated_at();

create table app.question_versions (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references app.questions (id) on delete cascade,
  version_number int not null check (version_number >= 1),
  grade smallint not null check (grade between 4 and 6),
  topic_id uuid not null references app.topics (id),
  difficulty smallint not null check (difficulty between 1 and 3),
  state text not null default 'draft'
    check (state in ('draft', 'in_review', 'approved', 'published', 'retired')),
  content_hash text not null,
  author_id uuid not null references app.accounts (id),
  approved_by uuid references app.accounts (id),
  approved_content_hash text,
  published_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, version_number),
  -- An approver can never be the author.
  check (approved_by is null or approved_by <> author_id)
);
create index question_versions_selection on app.question_versions (grade, topic_id, state);
create index question_versions_content_hash on app.question_versions (content_hash);
-- At most one live published version per question.
create unique index question_versions_one_published on app.question_versions (question_id)
  where state = 'published';
create trigger question_versions_touch before update on app.question_versions
  for each row execute function app.touch_updated_at();

alter table app.questions
  add constraint questions_active_version_fk
  foreign key (active_version_id) references app.question_versions (id);

create table app.question_localizations (
  version_id uuid not null references app.question_versions (id) on delete cascade,
  locale text not null,
  stem_blocks jsonb not null check (jsonb_typeof(stem_blocks) = 'array'),
  options jsonb not null check (jsonb_typeof(options) = 'array'),
  explanation_blocks jsonb not null check (jsonb_typeof(explanation_blocks) = 'array'),
  schema_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (version_id, locale)
);
create trigger question_localizations_touch before update on app.question_localizations
  for each row execute function app.touch_updated_at();

create table private.answer_keys (
  version_id uuid primary key references app.question_versions (id) on delete cascade,
  correct_option_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Published and retired versions are immutable. The only permitted changes are the
-- published -> retired transition and its timestamp.
create function app.guard_version_immutability() returns trigger
language plpgsql
as $$
begin
  if old.state in ('published', 'retired') then
    if new.question_id <> old.question_id or new.version_number <> old.version_number
       or new.grade <> old.grade or new.topic_id <> old.topic_id
       or new.difficulty <> old.difficulty or new.content_hash <> old.content_hash
       or new.author_id <> old.author_id
       or new.approved_by is distinct from old.approved_by
       or new.published_at is distinct from old.published_at
       or not (new.state = old.state or (old.state = 'published' and new.state = 'retired'))
    then
      raise exception 'published version % is immutable', old.id using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger question_versions_immutable before update on app.question_versions
  for each row execute function app.guard_version_immutability();

create function app.guard_localization_immutability() returns trigger
language plpgsql
as $$
declare v_state text;
begin
  select state into v_state from app.question_versions
   where id = coalesce(old.version_id, new.version_id);
  if v_state in ('published', 'retired') then
    raise exception 'content of a published version is immutable' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger question_localizations_immutable
  before update or delete on app.question_localizations
  for each row execute function app.guard_localization_immutability();
create trigger answer_keys_immutable
  before update or delete on private.answer_keys
  for each row execute function app.guard_localization_immutability();

create table app.assets (
  id uuid primary key default gen_random_uuid(),
  object_key text not null unique,
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  byte_size int not null check (byte_size > 0 and byte_size <= 2097152),
  checksum text not null,
  alt_text text not null,
  status text not null default 'pending' check (status in ('pending', 'ready')),
  uploaded_by uuid not null references app.accounts (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger assets_touch before update on app.assets
  for each row execute function app.touch_updated_at();

create table app.version_assets (
  version_id uuid not null references app.question_versions (id) on delete cascade,
  asset_id uuid not null references app.assets (id),
  usage text not null check (usage in ('stem', 'solution')),
  created_at timestamptz not null default now(),
  primary key (version_id, asset_id, usage)
);

create table app.content_reviews (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references app.question_versions (id) on delete cascade,
  reviewer_id uuid not null references app.accounts (id),
  decision text not null check (decision in ('approve', 'request_changes')),
  comments text,
  reviewed_content_hash text not null,
  created_at timestamptz not null default now()
);
create index content_reviews_version on app.content_reviews (version_id, created_at desc);

create table app.content_imports (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references app.accounts (id),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  payload jsonb not null,
  total_items int not null,
  created_count int not null default 0,
  duplicate_count int not null default 0,
  errors jsonb not null default '[]'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger content_imports_touch before update on app.content_imports
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security. Non-staff principals only ever see published/retired content, and only
-- through API DTOs that strip answer metadata.
-- ---------------------------------------------------------------------------

alter table app.topics enable row level security;
alter table app.topics force row level security;
create policy topics_select on app.topics for select using (app.has_context());
create policy topics_write on app.topics for all
  using (app.has_staff_role('administrator') or app.is_system())
  with check (app.has_staff_role('administrator') or app.is_system());

alter table app.questions enable row level security;
alter table app.questions force row level security;
create policy questions_select on app.questions for select using (app.has_context());
create policy questions_write on app.questions for insert
  with check (app.has_staff_role('editor') or app.has_staff_role('administrator') or app.is_system());
create policy questions_update on app.questions for update
  using (app.has_staff_role() or app.is_system());

alter table app.question_versions enable row level security;
alter table app.question_versions force row level security;
create policy versions_select on app.question_versions for select
  using (state in ('published', 'retired') and app.has_context()
         or app.has_staff_role() or app.is_system());
create policy versions_insert on app.question_versions for insert
  with check (app.has_staff_role('editor') or app.has_staff_role('administrator') or app.is_system());
create policy versions_update on app.question_versions for update
  using (app.has_staff_role() or app.is_system());

alter table app.question_localizations enable row level security;
alter table app.question_localizations force row level security;
create policy localizations_select on app.question_localizations for select
  using (exists (select 1 from app.question_versions v where v.id = version_id));
create policy localizations_write on app.question_localizations for all
  using (app.has_staff_role('editor') or app.has_staff_role('administrator') or app.is_system())
  with check (app.has_staff_role('editor') or app.has_staff_role('administrator') or app.is_system());

alter table app.assets enable row level security;
alter table app.assets force row level security;
create policy assets_select on app.assets for select using (app.has_context());
create policy assets_write on app.assets for all
  using (app.has_staff_role('editor') or app.has_staff_role('administrator') or app.is_system())
  with check (app.has_staff_role('editor') or app.has_staff_role('administrator') or app.is_system());

alter table app.version_assets enable row level security;
alter table app.version_assets force row level security;
create policy version_assets_select on app.version_assets for select
  using (exists (select 1 from app.question_versions v where v.id = version_id));
create policy version_assets_write on app.version_assets for all
  using (app.has_staff_role('editor') or app.has_staff_role('administrator') or app.is_system())
  with check (app.has_staff_role('editor') or app.has_staff_role('administrator') or app.is_system());

alter table app.content_reviews enable row level security;
alter table app.content_reviews force row level security;
create policy reviews_select on app.content_reviews for select
  using (app.has_staff_role() or app.is_system());
create policy reviews_insert on app.content_reviews for insert
  with check (reviewer_id = app.ctx_account()
              and (app.has_staff_role('reviewer') or app.has_staff_role('administrator')));

alter table app.content_imports enable row level security;
alter table app.content_imports force row level security;
create policy imports_all on app.content_imports for all
  using (app.has_staff_role() or app.is_system())
  with check (app.has_staff_role('editor') or app.has_staff_role('administrator') or app.is_system());

grant select, insert, update, delete on
  app.topics, app.questions, app.question_versions, app.question_localizations,
  app.assets, app.version_assets, app.content_imports
to imc_api;
grant select, insert on app.content_reviews to imc_api;

-- Staff access to answer keys goes through these functions; the runtime role has no grant on
-- private.answer_keys.
create function app.staff_answer_key(p_version_id uuid) returns text
language plpgsql stable security definer
set search_path = pg_catalog, app, private
as $$
begin
  if not (app.has_staff_role() or app.is_system()) then
    raise exception 'answer keys are not readable by this principal' using errcode = '42501';
  end if;
  return (select k.correct_option_id from private.answer_keys k where k.version_id = p_version_id);
end $$;

create function app.staff_set_answer_key(p_version_id uuid, p_option_id text) returns void
language plpgsql volatile security definer
set search_path = pg_catalog, app, private
as $$
declare v_state text;
begin
  if not (app.has_staff_role('editor') or app.has_staff_role('administrator') or app.is_system()) then
    raise exception 'answer keys are not writable by this principal' using errcode = '42501';
  end if;
  select state into v_state from app.question_versions where id = p_version_id;
  if v_state is null then
    raise exception 'version not found' using errcode = 'P0002';
  end if;
  if v_state not in ('draft', 'in_review', 'approved') then
    raise exception 'answer key of a published version is immutable' using errcode = '42501';
  end if;
  insert into private.answer_keys (version_id, correct_option_id)
  values (p_version_id, p_option_id)
  on conflict (version_id) do update
    set correct_option_id = excluded.correct_option_id, updated_at = now();
end $$;

revoke all on function app.staff_answer_key(uuid) from public;
revoke all on function app.staff_set_answer_key(uuid, text) from public;
grant execute on function app.staff_answer_key(uuid) to imc_api;
grant execute on function app.staff_set_answer_key(uuid, text) to imc_api;
