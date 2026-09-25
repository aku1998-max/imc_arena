-- Practice sessions, items, immutable attempts, review queue, rewards and progress projection.

create table app.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app.students (id) on delete cascade,
  mode text not null check (mode in ('daily', 'topic', 'mistakes')),
  topic_id uuid references app.topics (id),
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  local_date date not null,
  timezone_snapshot text not null,
  selection_seed text not null,
  item_count int not null,
  correct_count int not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (mode <> 'topic' or topic_id is not null)
);
-- One daily challenge per student per local date.
create unique index practice_sessions_daily_unique on app.practice_sessions (student_id, local_date)
  where mode = 'daily';
-- One unfinished session per student per mode/topic.
create unique index practice_sessions_one_active on app.practice_sessions
  (student_id, mode, coalesce(topic_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active';
create index practice_sessions_student_started on app.practice_sessions (student_id, started_at desc);

create table app.session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references app.practice_sessions (id) on delete cascade,
  ordinal int not null check (ordinal >= 1),
  question_version_id uuid not null references app.question_versions (id),
  locale_snapshot text not null,
  choice_order jsonb not null check (jsonb_typeof(choice_order) = 'array'),
  state text not null default 'pending' check (state in ('pending', 'answered')),
  created_at timestamptz not null default now(),
  unique (session_id, ordinal),
  unique (session_id, question_version_id)
);
create index session_items_session_ordinal on app.session_items (session_id, ordinal);

create table app.attempts (
  id uuid primary key default gen_random_uuid(),
  session_item_id uuid not null unique references app.session_items (id) on delete cascade,
  -- Denormalized from the item/version for isolation policies and progress queries.
  student_id uuid not null references app.students (id) on delete cascade,
  question_id uuid not null references app.questions (id),
  selected_option_id text not null,
  is_correct boolean not null,
  received_at timestamptz not null default now(),
  response_ms_reported int check (response_ms_reported is null or response_ms_reported >= 0),
  scoring_version int not null default 1,
  created_at timestamptz not null default now()
);
create index attempts_received on app.attempts (received_at);
create index attempts_student_received on app.attempts (student_id, received_at);
create trigger attempts_immutable before update on app.attempts
  for each row execute function app.reject_mutation();

create table app.review_items (
  student_id uuid not null references app.students (id) on delete cascade,
  question_id uuid not null references app.questions (id),
  latest_failed_version_id uuid not null references app.question_versions (id),
  last_failed_at timestamptz not null,
  due_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, question_id)
);
create index review_items_due on app.review_items (student_id, due_at) where resolved_at is null;
create trigger review_items_touch before update on app.review_items
  for each row execute function app.touch_updated_at();

create table app.reward_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app.students (id) on delete cascade,
  source_session_id uuid not null references app.practice_sessions (id) on delete cascade,
  reward_type text not null,
  value int not null,
  created_at timestamptz not null default now(),
  unique (student_id, source_session_id, reward_type)
);
create trigger reward_events_immutable before update on app.reward_events
  for each row execute function app.reject_mutation();

create table app.progress_daily (
  student_id uuid not null references app.students (id) on delete cascade,
  local_date date not null,
  completed_sessions int not null default 0,
  first_attempt_count int not null default 0,
  correct_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, local_date)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table app.practice_sessions enable row level security;
alter table app.practice_sessions force row level security;
create policy sessions_select on app.practice_sessions for select
  using (app.can_access_student(student_id));
create policy sessions_insert on app.practice_sessions for insert
  with check (app.ctx_type() = 'child' and student_id = app.ctx_student() or app.is_system());
create policy sessions_update on app.practice_sessions for update
  using (app.ctx_type() = 'child' and student_id = app.ctx_student() or app.is_system());
create policy sessions_delete on app.practice_sessions for delete using (app.is_system());

alter table app.session_items enable row level security;
alter table app.session_items force row level security;
create policy items_select on app.session_items for select
  using (exists (select 1 from app.practice_sessions s where s.id = session_id));
create policy items_insert on app.session_items for insert
  with check (exists (select 1 from app.practice_sessions s where s.id = session_id
                      and (s.student_id = app.ctx_student() and app.ctx_type() = 'child'
                           or app.is_system())));
create policy items_update on app.session_items for update
  using (exists (select 1 from app.practice_sessions s where s.id = session_id
                 and (s.student_id = app.ctx_student() and app.ctx_type() = 'child'
                      or app.is_system())));

alter table app.attempts enable row level security;
alter table app.attempts force row level security;
create policy attempts_select on app.attempts for select
  using (app.can_access_student(student_id));
create policy attempts_insert on app.attempts for insert
  with check (app.ctx_type() = 'child' and student_id = app.ctx_student()
              and exists (select 1 from app.session_items i
                          join app.practice_sessions s on s.id = i.session_id
                          where i.id = session_item_id and s.student_id = app.ctx_student()));
create policy attempts_delete on app.attempts for delete using (app.is_system());

alter table app.review_items enable row level security;
alter table app.review_items force row level security;
create policy review_select on app.review_items for select
  using (app.can_access_student(student_id));
create policy review_write on app.review_items for all
  using (app.ctx_type() = 'child' and student_id = app.ctx_student() or app.is_system())
  with check (app.ctx_type() = 'child' and student_id = app.ctx_student() or app.is_system());

alter table app.reward_events enable row level security;
alter table app.reward_events force row level security;
create policy rewards_select on app.reward_events for select
  using (app.can_access_student(student_id));
create policy rewards_insert on app.reward_events for insert
  with check (app.ctx_type() = 'child' and student_id = app.ctx_student() or app.is_system());
create policy rewards_delete on app.reward_events for delete using (app.is_system());

alter table app.progress_daily enable row level security;
alter table app.progress_daily force row level security;
create policy progress_select on app.progress_daily for select
  using (app.can_access_student(student_id));
create policy progress_write on app.progress_daily for all
  using (app.is_system()) with check (app.is_system());

grant select, insert, update, delete on
  app.practice_sessions, app.session_items, app.review_items, app.progress_daily
to imc_api;
grant select, insert, delete on app.attempts, app.reward_events to imc_api;

-- ---------------------------------------------------------------------------
-- Grading. The only ways a non-staff principal can learn an answer key.
-- Both functions recheck ownership themselves and never return another item's key.
-- ---------------------------------------------------------------------------

-- Grades one option for one item owned by the calling child. The item must be pending and in an
-- active session, and the option must be one of the item's choices.
create function app.grade_item(p_item_id uuid, p_option_id text)
returns table (is_correct boolean, correct_option_id text)
language plpgsql stable security definer
set search_path = pg_catalog, app, private
as $$
declare
  v_version uuid;
  v_choices jsonb;
  v_key text;
begin
  if app.ctx_type() is distinct from 'child' or app.ctx_student() is null then
    raise exception 'grading requires a child principal' using errcode = '42501';
  end if;
  select i.question_version_id, i.choice_order into v_version, v_choices
    from app.session_items i
    join app.practice_sessions s on s.id = i.session_id
   where i.id = p_item_id
     and s.student_id = app.ctx_student()
     and s.status = 'active'
     and i.state = 'pending';
  if v_version is null then
    raise exception 'item not gradable' using errcode = 'P0002';
  end if;
  if not (v_choices ? p_option_id) then
    raise exception 'option is not a choice of this item' using errcode = '22023';
  end if;
  select k.correct_option_id into v_key from private.answer_keys k where k.version_id = v_version;
  if v_key is null then
    raise exception 'answer key missing' using errcode = 'P0002';
  end if;
  return query select v_key = p_option_id, v_key;
end $$;

-- Reveals the key of an already answered item to its student or that student's guardian.
create function app.revealed_answer_key(p_item_id uuid) returns text
language plpgsql stable security definer
set search_path = pg_catalog, app, private
as $$
declare v_version uuid;
begin
  select i.question_version_id into v_version
    from app.session_items i
    join app.practice_sessions s on s.id = i.session_id
    join app.attempts a on a.session_item_id = i.id
   where i.id = p_item_id
     and (
       (app.ctx_type() = 'child' and s.student_id = app.ctx_student())
       or app.is_guardian_of(s.student_id)
     );
  if v_version is null then
    return null;
  end if;
  return (select k.correct_option_id from private.answer_keys k where k.version_id = v_version);
end $$;

revoke all on function app.grade_item(uuid, text) from public;
revoke all on function app.revealed_answer_key(uuid) from public;
grant execute on function app.grade_item(uuid, text) to imc_api;
grant execute on function app.revealed_answer_key(uuid) to imc_api;
