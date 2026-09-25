import type { Tx } from '../context.js';

export interface CandidateRow {
  questionId: string;
  versionId: string;
  topicId: string;
  difficulty: number;
}

/**
 * Published, rights-cleared candidates for a grade/locale (optionally one topic). One published
 * version per question is guaranteed by a unique index, so rows are distinct question identities.
 */
export async function selectionCandidates(
  tx: Tx,
  filter: { grade: number; locale: string; topicId?: string | null },
): Promise<CandidateRow[]> {
  const { rows } = await tx.query<CandidateRow>(
    `select v.question_id as "questionId", v.id as "versionId", v.topic_id as "topicId", v.difficulty
       from app.question_versions v
       join app.questions q on q.id = v.question_id
       join app.topics t on t.id = v.topic_id and t.active
       join app.question_localizations l on l.version_id = v.id and l.locale = $2
      where v.state = 'published'
        and q.rights_status = 'cleared'
        and v.grade = $1
        and ($3::uuid is null or v.topic_id = $3)
      order by v.question_id`,
    [filter.grade, filter.locale, filter.topicId ?? null],
  );
  return rows;
}

/** Question identities assigned to this student in sessions started within `days`. */
export async function recentQuestionIds(tx: Tx, studentId: string, days: number) {
  const { rows } = await tx.query<{ questionId: string }>(
    `select distinct v.question_id as "questionId"
       from app.practice_sessions s
       join app.session_items i on i.session_id = s.id
       join app.question_versions v on v.id = i.question_version_id
      where s.student_id = $1 and s.started_at > now() - make_interval(days => $2)`,
    [studentId, days],
  );
  return new Set(rows.map((r) => r.questionId));
}

export interface SessionRow {
  id: string;
  studentId: string;
  mode: 'daily' | 'topic' | 'mistakes';
  topicId: string | null;
  status: 'active' | 'completed' | 'abandoned';
  localDate: string;
  itemCount: number;
  correctCount: number;
  startedAt: string;
  completedAt: string | null;
}

const SESSION_COLS = `s.id, s.student_id as "studentId", s.mode, s.topic_id as "topicId", s.status,
  s.local_date as "localDate", s.item_count as "itemCount", s.correct_count as "correctCount",
  s.started_at as "startedAt", s.completed_at as "completedAt"`;

export async function lockDailySelection(tx: Tx, studentId: string, key: string) {
  await tx.query(`select pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))`, [
    studentId,
    key,
  ]);
}

export async function findDailySession(
  tx: Tx,
  studentId: string,
  localDate: string,
): Promise<SessionRow | null> {
  const { rows } = await tx.query<SessionRow>(
    `select ${SESSION_COLS} from app.practice_sessions s
      where s.student_id = $1 and s.mode = 'daily' and s.local_date = $2`,
    [studentId, localDate],
  );
  return rows[0] ?? null;
}

export async function findActiveSession(
  tx: Tx,
  studentId: string,
  mode: string,
  topicId: string | null,
): Promise<SessionRow | null> {
  const { rows } = await tx.query<SessionRow>(
    `select ${SESSION_COLS} from app.practice_sessions s
      where s.student_id = $1 and s.mode = $2 and s.status = 'active'
        and s.topic_id is not distinct from $3`,
    [studentId, mode, topicId],
  );
  return rows[0] ?? null;
}

export async function listActiveSessions(tx: Tx, studentId: string) {
  const { rows } = await tx.query<SessionRow & { answeredCount: number }>(
    `select ${SESSION_COLS},
            (select count(*)::int from app.session_items i
              where i.session_id = s.id and i.state = 'answered') as "answeredCount"
       from app.practice_sessions s
      where s.student_id = $1 and s.status = 'active'
      order by s.started_at desc`,
    [studentId],
  );
  return rows;
}

export async function recentCompletedSessions(tx: Tx, studentId: string, limit: number) {
  const { rows } = await tx.query<SessionRow>(
    `select ${SESSION_COLS} from app.practice_sessions s
      where s.student_id = $1 and s.status = 'completed'
      order by s.completed_at desc, s.id desc limit $2`,
    [studentId, limit],
  );
  return rows;
}

export async function countCompletedSessionsBetween(
  tx: Tx,
  studentId: string,
  from: string,
  to: string,
): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `select count(*)::int as n from app.practice_sessions
      where student_id = $1 and status = 'completed' and local_date between $2 and $3`,
    [studentId, from, to],
  );
  return rows[0]?.n ?? 0;
}

export async function insertSession(
  tx: Tx,
  input: {
    id: string;
    studentId: string;
    mode: string;
    topicId: string | null;
    localDate: string;
    timezone: string;
    seed: string;
    itemCount: number;
  },
): Promise<void> {
  await tx.query(
    `insert into app.practice_sessions
       (id, student_id, mode, topic_id, local_date, timezone_snapshot, selection_seed, item_count)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.id,
      input.studentId,
      input.mode,
      input.topicId,
      input.localDate,
      input.timezone,
      input.seed,
      input.itemCount,
    ],
  );
}

export async function insertSessionItem(
  tx: Tx,
  input: {
    sessionId: string;
    ordinal: number;
    versionId: string;
    locale: string;
    choiceOrder: string[];
  },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into app.session_items (session_id, ordinal, question_version_id, locale_snapshot, choice_order)
     values ($1, $2, $3, $4, $5) returning id`,
    [
      input.sessionId,
      input.ordinal,
      input.versionId,
      input.locale,
      JSON.stringify(input.choiceOrder),
    ],
  );
  return rows[0]!.id;
}

export async function findSession(
  tx: Tx,
  id: string,
  opts: { forUpdate?: boolean } = {},
): Promise<SessionRow | null> {
  const { rows } = await tx.query<SessionRow>(
    `select ${SESSION_COLS} from app.practice_sessions s where s.id = $1
     ${opts.forUpdate ? 'for update' : ''}`,
    [id],
  );
  return rows[0] ?? null;
}

export interface ItemStateRow {
  itemId: string;
  ordinal: number;
  state: 'pending' | 'answered';
  isCorrect: boolean | null;
}

export async function listSessionItems(tx: Tx, sessionId: string): Promise<ItemStateRow[]> {
  const { rows } = await tx.query<ItemStateRow>(
    `select i.id as "itemId", i.ordinal, i.state, a.is_correct as "isCorrect"
       from app.session_items i
       left join app.attempts a on a.session_item_id = i.id
      where i.session_id = $1
      order by i.ordinal`,
    [sessionId],
  );
  return rows;
}

export interface ItemRow {
  id: string;
  sessionId: string;
  ordinal: number;
  versionId: string;
  questionId: string;
  topicId: string;
  locale: string;
  choiceOrder: string[];
  state: 'pending' | 'answered';
}

export async function findItem(
  tx: Tx,
  sessionId: string,
  itemId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<ItemRow | null> {
  const { rows } = await tx.query<ItemRow>(
    `select i.id, i.session_id as "sessionId", i.ordinal, i.question_version_id as "versionId",
            v.question_id as "questionId", v.topic_id as "topicId",
            i.locale_snapshot as locale, i.choice_order as "choiceOrder", i.state
       from app.session_items i
       join app.question_versions v on v.id = i.question_version_id
      where i.id = $1 and i.session_id = $2
      ${opts.forUpdate ? 'for update of i' : ''}`,
    [itemId, sessionId],
  );
  return rows[0] ?? null;
}

export async function markItemAnswered(tx: Tx, itemId: string) {
  await tx.query(`update app.session_items set state = 'answered' where id = $1`, [itemId]);
}

export interface AttemptRow {
  id: string;
  sessionItemId: string;
  selectedOptionId: string;
  isCorrect: boolean;
  receivedAt: string;
}

export async function findAttemptForItem(tx: Tx, itemId: string): Promise<AttemptRow | null> {
  const { rows } = await tx.query<AttemptRow>(
    `select id, session_item_id as "sessionItemId", selected_option_id as "selectedOptionId",
            is_correct as "isCorrect", received_at as "receivedAt"
       from app.attempts where session_item_id = $1`,
    [itemId],
  );
  return rows[0] ?? null;
}

export async function gradeItem(
  tx: Tx,
  itemId: string,
  optionId: string,
): Promise<{ isCorrect: boolean; correctOptionId: string }> {
  const { rows } = await tx.query<{ isCorrect: boolean; correctOptionId: string }>(
    `select is_correct as "isCorrect", correct_option_id as "correctOptionId"
       from app.grade_item($1, $2)`,
    [itemId, optionId],
  );
  return rows[0]!;
}

export async function revealedAnswerKey(tx: Tx, itemId: string): Promise<string | null> {
  const { rows } = await tx.query<{ key: string | null }>(
    `select app.revealed_answer_key($1) as key`,
    [itemId],
  );
  return rows[0]?.key ?? null;
}

export async function insertAttempt(
  tx: Tx,
  input: {
    itemId: string;
    studentId: string;
    questionId: string;
    optionId: string;
    isCorrect: boolean;
    responseMs: number | null;
    scoringVersion: number;
  },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into app.attempts
       (session_item_id, student_id, question_id, selected_option_id, is_correct,
        response_ms_reported, scoring_version)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      input.itemId,
      input.studentId,
      input.questionId,
      input.optionId,
      input.isCorrect,
      input.responseMs,
      input.scoringVersion,
    ],
  );
  return rows[0]!.id;
}

export async function hasEarlierAttempt(
  tx: Tx,
  studentId: string,
  questionId: string,
  excludeItemId: string,
): Promise<boolean> {
  const { rows } = await tx.query(
    `select 1 from app.attempts
      where student_id = $1 and question_id = $2 and session_item_id <> $3 limit 1`,
    [studentId, questionId, excludeItemId],
  );
  return rows.length > 0;
}

export async function completeSession(tx: Tx, sessionId: string, correctCount: number) {
  await tx.query(
    `update app.practice_sessions set status = 'completed', completed_at = now(), correct_count = $2
      where id = $1 and status = 'active'`,
    [sessionId, correctCount],
  );
}

export async function countCorrect(tx: Tx, sessionId: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `select count(*)::int as n from app.attempts a join app.session_items i on i.id = a.session_item_id
      where i.session_id = $1 and a.is_correct`,
    [sessionId],
  );
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Review queue and rewards
// ---------------------------------------------------------------------------

export async function upsertReviewItem(
  tx: Tx,
  input: { studentId: string; questionId: string; versionId: string; dueAt: Date },
) {
  await tx.query(
    `insert into app.review_items (student_id, question_id, latest_failed_version_id, last_failed_at, due_at)
     values ($1, $2, $3, now(), $4)
     on conflict (student_id, question_id) do update set
       latest_failed_version_id = excluded.latest_failed_version_id,
       last_failed_at = excluded.last_failed_at,
       due_at = excluded.due_at,
       resolved_at = null`,
    [input.studentId, input.questionId, input.versionId, input.dueAt],
  );
}

export async function resolveReviewItem(tx: Tx, studentId: string, questionId: string) {
  await tx.query(
    `update app.review_items set resolved_at = now()
      where student_id = $1 and question_id = $2 and resolved_at is null`,
    [studentId, questionId],
  );
}

/** Due unresolved mistakes joined to the question's currently published version. */
export async function dueReviewCandidates(
  tx: Tx,
  input: { studentId: string; locale: string; limit: number },
): Promise<Array<CandidateRow & { dueAt: string }>> {
  const { rows } = await tx.query<CandidateRow & { dueAt: string }>(
    `select r.question_id as "questionId", v.id as "versionId", v.topic_id as "topicId",
            v.difficulty, r.due_at as "dueAt"
       from app.review_items r
       join app.question_versions v on v.question_id = r.question_id and v.state = 'published'
       join app.questions q on q.id = r.question_id and q.rights_status = 'cleared'
       join app.question_localizations l on l.version_id = v.id and l.locale = $2
      where r.student_id = $1 and r.resolved_at is null and r.due_at <= now()
      order by r.due_at, r.question_id
      limit $3`,
    [input.studentId, input.locale, input.limit],
  );
  return rows;
}

export async function listMistakes(
  tx: Tx,
  input: { studentId: string; cursor?: { dueAt: string; questionId: string }; limit: number },
) {
  const { rows } = await tx.query<{
    questionId: string;
    topicId: string;
    topicSlug: string;
    topicDisplayKey: string;
    dueAt: string;
    lastFailedAt: string;
  }>(
    `select r.question_id as "questionId", t.id as "topicId", t.slug as "topicSlug",
            t.display_key as "topicDisplayKey", r.due_at as "dueAt",
            r.last_failed_at as "lastFailedAt"
       from app.review_items r
       join app.question_versions v on v.id = r.latest_failed_version_id
       join app.topics t on t.id = v.topic_id
      where r.student_id = $1 and r.resolved_at is null
        and ($2::timestamptz is null or (r.due_at, r.question_id) > ($2, $3::uuid))
      order by r.due_at, r.question_id
      limit $4`,
    [input.studentId, input.cursor?.dueAt ?? null, input.cursor?.questionId ?? null, input.limit],
  );
  return rows;
}

export async function insertReward(
  tx: Tx,
  input: { studentId: string; sessionId: string; type: string; value: number },
): Promise<boolean> {
  const { rowCount } = await tx.query(
    `insert into app.reward_events (student_id, source_session_id, reward_type, value)
     values ($1, $2, $3, $4) on conflict (student_id, source_session_id, reward_type) do nothing`,
    [input.studentId, input.sessionId, input.type, input.value],
  );
  return (rowCount ?? 0) === 1;
}

export async function listRewards(tx: Tx, sessionId: string) {
  const { rows } = await tx.query<{ type: string; value: number }>(
    `select reward_type as type, value from app.reward_events where source_session_id = $1
      order by reward_type`,
    [sessionId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface ProgressAttemptRow {
  questionId: string;
  topicId: string;
  isCorrect: boolean;
  isFirstEncounter: boolean;
  localDate: string;
}

/**
 * Attempts in sessions whose local date is within [from, to]. isFirstEncounter is true for the
 * student's first-ever attempt at a question identity; everything else counts as a retry.
 */
export async function progressAttempts(
  tx: Tx,
  studentId: string,
  from: string,
  to: string,
): Promise<ProgressAttemptRow[]> {
  const { rows } = await tx.query<ProgressAttemptRow>(
    `with ranked as (
       select a.question_id, a.is_correct, s.local_date, v.topic_id,
              row_number() over (partition by a.question_id order by a.received_at, a.id) as rn
         from app.attempts a
         join app.session_items i on i.id = a.session_item_id
         join app.practice_sessions s on s.id = i.session_id
         join app.question_versions v on v.id = i.question_version_id
        where a.student_id = $1
     )
     select question_id as "questionId", topic_id as "topicId", is_correct as "isCorrect",
            rn = 1 as "isFirstEncounter", local_date as "localDate"
       from ranked where local_date between $2 and $3`,
    [studentId, from, to],
  );
  return rows;
}

export async function completedSessionDates(
  tx: Tx,
  studentId: string,
  from: string,
  to: string,
): Promise<string[]> {
  const { rows } = await tx.query<{ localDate: string }>(
    `select local_date as "localDate" from app.practice_sessions
      where student_id = $1 and status = 'completed' and local_date between $2 and $3`,
    [studentId, from, to],
  );
  return rows.map((r) => r.localDate);
}

/** Rebuilds the progress_daily projection for one student/date from source records. */
export async function refreshProgressDaily(tx: Tx, studentId: string, localDate: string) {
  await tx.query(
    `with first_attempts as (
       select a.is_correct, s.local_date,
              row_number() over (partition by a.question_id order by a.received_at, a.id) as rn
         from app.attempts a
         join app.session_items i on i.id = a.session_item_id
         join app.practice_sessions s on s.id = i.session_id
        where a.student_id = $1
     )
     insert into app.progress_daily (student_id, local_date, completed_sessions, first_attempt_count, correct_count)
     select $1, $2::date,
            (select count(*) from app.practice_sessions
              where student_id = $1 and local_date = $2::date and status = 'completed'),
            (select count(*) from first_attempts where rn = 1 and local_date = $2::date),
            (select count(*) from first_attempts where rn = 1 and local_date = $2::date and is_correct)
     on conflict (student_id, local_date) do update set
       completed_sessions = excluded.completed_sessions,
       first_attempt_count = excluded.first_attempt_count,
       correct_count = excluded.correct_count,
       updated_at = now()`,
    [studentId, localDate],
  );
}

export async function progressDailyRange(tx: Tx, studentId: string, from: string, to: string) {
  const { rows } = await tx.query<{
    localDate: string;
    completedSessions: number;
    firstAttemptCount: number;
    correctCount: number;
  }>(
    `select local_date as "localDate", completed_sessions as "completedSessions",
            first_attempt_count as "firstAttemptCount", correct_count as "correctCount"
       from app.progress_daily where student_id = $1 and local_date between $2 and $3
      order by local_date`,
    [studentId, from, to],
  );
  return rows;
}

/** Attempts affected by a wrong key: used by the correction runbook. */
export async function flagAttemptsForVersion(tx: Tx, versionId: string): Promise<number> {
  // attempts are immutable; flagging is recorded as an audit + ops alert instead of an update.
  const { rows } = await tx.query<{ n: number }>(
    `select count(*)::int as n from app.attempts a
       join app.session_items i on i.id = a.session_item_id
      where i.question_version_id = $1`,
    [versionId],
  );
  return rows[0]?.n ?? 0;
}

export async function abandonActiveSessionsForVersion(tx: Tx, versionId: string): Promise<number> {
  const { rowCount } = await tx.query(
    `update app.practice_sessions s set status = 'abandoned'
      where s.status = 'active' and exists (
        select 1 from app.session_items i
         where i.session_id = s.id and i.question_version_id = $1 and i.state = 'pending')`,
    [versionId],
  );
  return rowCount ?? 0;
}

/** Most recent daily session; guards against extra challenges after a timezone change. */
export async function latestDailySession(tx: Tx, studentId: string): Promise<SessionRow | null> {
  const { rows } = await tx.query<SessionRow>(
    `select ${SESSION_COLS} from app.practice_sessions s
      where s.student_id = $1 and s.mode = 'daily'
      order by s.local_date desc limit 1`,
    [studentId],
  );
  return rows[0] ?? null;
}
