import type { Tx } from '../context.js';

/** Collects a student's personal records for a guardian data export. */
export async function studentExportData(tx: Tx, studentId: string) {
  const one = async (sql: string) => (await tx.query(sql, [studentId])).rows;
  return {
    profile: await one(
      `select id, nickname, avatar_key, grade, locale, timezone, created_at
         from app.students where id = $1`,
    ),
    consents: await one(
      `select purpose, policy_version, granted_at, withdrawn_at
         from app.consent_records where student_id = $1 order by granted_at`,
    ),
    sessions: await one(
      `select id, mode, status, local_date, item_count, correct_count, started_at, completed_at
         from app.practice_sessions where student_id = $1 order by started_at`,
    ),
    attempts: await one(
      `select a.id, i.session_id, i.question_version_id, a.selected_option_id, a.is_correct,
              a.received_at
         from app.attempts a join app.session_items i on i.id = a.session_item_id
        where a.student_id = $1 order by a.received_at`,
    ),
    rewards: await one(
      `select reward_type, value, created_at from app.reward_events where student_id = $1`,
    ),
    devices: await one(
      `select device_label, created_at, expires_at, revoked_at
         from app.child_sessions where student_id = $1`,
    ),
  };
}
