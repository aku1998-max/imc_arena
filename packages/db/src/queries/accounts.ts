import type { Tx } from '../context.js';

export interface AccountRow {
  id: string;
  status: 'active' | 'deleting' | 'closed';
  preferredLocale: string;
  billingCustomerId: string;
}

const ACCOUNT_COLS = `id, status, preferred_locale as "preferredLocale",
  billing_customer_id as "billingCustomerId"`;

export async function findAccount(tx: Tx, id: string): Promise<AccountRow | null> {
  const { rows } = await tx.query<AccountRow>(
    `select ${ACCOUNT_COLS} from app.accounts where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** First verified sign-in creates the account row keyed by the Auth subject. */
export async function ensureAccount(tx: Tx, id: string, locale: string): Promise<AccountRow> {
  await tx.query(
    `insert into app.accounts (id, preferred_locale) values ($1, $2) on conflict (id) do nothing`,
    [id, locale],
  );
  const row = await findAccount(tx, id);
  if (!row) throw new Error('account not visible after insert');
  return row;
}

export async function findAccountByBillingCustomer(
  tx: Tx,
  billingCustomerId: string,
): Promise<AccountRow | null> {
  const { rows } = await tx.query<AccountRow>(
    `select ${ACCOUNT_COLS} from app.accounts where billing_customer_id = $1`,
    [billingCustomerId],
  );
  return rows[0] ?? null;
}

export async function setAccountStatus(tx: Tx, id: string, status: AccountRow['status']) {
  await tx.query(`update app.accounts set status = $2 where id = $1`, [id, status]);
}

export async function deleteAccountRow(tx: Tx, id: string) {
  await tx.query(`delete from app.accounts where id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Students and guardianship
// ---------------------------------------------------------------------------

export interface StudentRow {
  id: string;
  nickname: string;
  avatarKey: string;
  grade: number;
  locale: string;
  timezone: string;
  status: 'active' | 'deleting';
  createdAt: string;
}

const STUDENT_COLS = `s.id, s.nickname, s.avatar_key as "avatarKey", s.grade, s.locale,
  s.timezone, s.status, s.created_at as "createdAt"`;

export async function insertStudentWithOwner(
  tx: Tx,
  input: {
    id: string;
    accountId: string;
    nickname: string;
    avatarKey: string;
    grade: number;
    locale: string;
    timezone: string;
  },
): Promise<void> {
  // No RETURNING: the row only becomes visible once the guardian link exists.
  await tx.query(
    `insert into app.students (id, nickname, avatar_key, grade, locale, timezone)
     values ($1, $2, $3, $4, $5, $6)`,
    [input.id, input.nickname, input.avatarKey, input.grade, input.locale, input.timezone],
  );
  await tx.query(
    `insert into app.guardian_links (account_id, student_id, role) values ($1, $2, 'owner')`,
    [input.accountId, input.id],
  );
}

export async function findStudent(tx: Tx, id: string): Promise<StudentRow | null> {
  const { rows } = await tx.query<StudentRow>(
    `select ${STUDENT_COLS} from app.students s where s.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listStudentsForAccount(tx: Tx, accountId: string): Promise<StudentRow[]> {
  const { rows } = await tx.query<StudentRow>(
    `select ${STUDENT_COLS}
       from app.students s
       join app.guardian_links g on g.student_id = s.id
      where g.account_id = $1
      order by s.created_at, s.id`,
    [accountId],
  );
  return rows;
}

export async function updateStudent(
  tx: Tx,
  id: string,
  patch: Partial<Pick<StudentRow, 'nickname' | 'avatarKey' | 'grade' | 'locale' | 'timezone'>>,
): Promise<boolean> {
  const { rowCount } = await tx.query(
    `update app.students set
        nickname = coalesce($2, nickname),
        avatar_key = coalesce($3, avatar_key),
        grade = coalesce($4, grade),
        locale = coalesce($5, locale),
        timezone = coalesce($6, timezone)
      where id = $1`,
    [
      id,
      patch.nickname ?? null,
      patch.avatarKey ?? null,
      patch.grade ?? null,
      patch.locale ?? null,
      patch.timezone ?? null,
    ],
  );
  return (rowCount ?? 0) > 0;
}

export async function setStudentStatus(tx: Tx, id: string, status: StudentRow['status']) {
  await tx.query(`update app.students set status = $2 where id = $1`, [id, status]);
}

export async function deleteStudentRow(tx: Tx, id: string) {
  await tx.query(`delete from app.students where id = $1`, [id]);
}

export async function guardianAccountsOf(tx: Tx, studentId: string): Promise<string[]> {
  const { rows } = await tx.query<{ accountId: string }>(
    `select account_id as "accountId" from app.guardian_links where student_id = $1`,
    [studentId],
  );
  return rows.map((r) => r.accountId);
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export interface ConsentRow {
  id: string;
  studentId: string;
  purpose: 'core_service' | 'parent_reminders' | 'product_analytics';
  policyVersion: string;
  grantedAt: string;
  withdrawnAt: string | null;
}

const CONSENT_COLS = `id, student_id as "studentId", purpose, policy_version as "policyVersion",
  granted_at as "grantedAt", withdrawn_at as "withdrawnAt"`;

export async function insertConsent(
  tx: Tx,
  input: { accountId: string; studentId: string; purpose: string; policyVersion: string },
): Promise<ConsentRow> {
  const { rows } = await tx.query<ConsentRow>(
    `insert into app.consent_records (account_id, student_id, purpose, policy_version)
     values ($1, $2, $3, $4) returning ${CONSENT_COLS}`,
    [input.accountId, input.studentId, input.purpose, input.policyVersion],
  );
  return rows[0]!;
}

export async function withdrawConsent(
  tx: Tx,
  input: { accountId: string; studentId: string; purpose: string },
): Promise<ConsentRow[]> {
  const { rows } = await tx.query<ConsentRow>(
    `update app.consent_records set withdrawn_at = now()
      where account_id = $1 and student_id = $2 and purpose = $3 and withdrawn_at is null
      returning ${CONSENT_COLS}`,
    [input.accountId, input.studentId, input.purpose],
  );
  return rows;
}

export async function listConsents(tx: Tx, accountId: string): Promise<ConsentRow[]> {
  const { rows } = await tx.query<ConsentRow>(
    `select ${CONSENT_COLS} from app.consent_records where account_id = $1
      order by granted_at desc, id`,
    [accountId],
  );
  return rows;
}

export async function hasActiveConsent(tx: Tx, studentId: string, purpose: string) {
  const { rows } = await tx.query(
    `select 1 from app.consent_records
      where student_id = $1 and purpose = $2 and withdrawn_at is null limit 1`,
    [studentId, purpose],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Child sessions and adult grants
// ---------------------------------------------------------------------------

export interface ChildSessionRow {
  id: string;
  studentId: string;
  deviceLabel: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

const CHILD_SESSION_COLS = `id, student_id as "studentId", device_label as "deviceLabel",
  created_at as "createdAt", expires_at as "expiresAt", revoked_at as "revokedAt"`;

export async function insertChildSession(
  tx: Tx,
  input: {
    studentId: string;
    createdBy: string;
    tokenHash: string;
    deviceLabel: string;
    expiresAt: Date;
  },
): Promise<ChildSessionRow> {
  const { rows } = await tx.query<ChildSessionRow>(
    `insert into app.child_sessions (student_id, created_by, token_hash, device_label, expires_at)
     values ($1, $2, $3, $4, $5) returning ${CHILD_SESSION_COLS}`,
    [input.studentId, input.createdBy, input.tokenHash, input.deviceLabel, input.expiresAt],
  );
  return rows[0]!;
}

export async function resolveChildSession(
  tx: Tx,
  tokenHash: string,
): Promise<{ sessionId: string; studentId: string; expiresAt: string } | null> {
  const { rows } = await tx.query<{ sessionId: string; studentId: string; expiresAt: string }>(
    `select session_id as "sessionId", student_id as "studentId", expires_at as "expiresAt"
       from app.resolve_child_session($1)`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function listChildSessions(tx: Tx, studentId: string): Promise<ChildSessionRow[]> {
  const { rows } = await tx.query<ChildSessionRow>(
    `select ${CHILD_SESSION_COLS} from app.child_sessions where student_id = $1
      order by created_at desc, id`,
    [studentId],
  );
  return rows;
}

export async function findChildSession(tx: Tx, id: string): Promise<ChildSessionRow | null> {
  const { rows } = await tx.query<ChildSessionRow>(
    `select ${CHILD_SESSION_COLS} from app.child_sessions where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function revokeChildSession(tx: Tx, id: string): Promise<void> {
  await tx.query(
    `update app.child_sessions set revoked_at = coalesce(revoked_at, now()) where id = $1`,
    [id],
  );
}

export async function revokeAllChildSessions(tx: Tx, studentId: string): Promise<number> {
  const { rowCount } = await tx.query(
    `update app.child_sessions set revoked_at = now()
      where student_id = $1 and revoked_at is null`,
    [studentId],
  );
  return rowCount ?? 0;
}

export async function touchChildSession(tx: Tx, id: string): Promise<void> {
  await tx.query(
    `update app.child_sessions set last_used_at = now()
      where id = $1 and (last_used_at is null or last_used_at < now() - interval '5 minutes')`,
    [id],
  );
}

export async function purgeExpiredChildSessions(tx: Tx, olderThanDays: number): Promise<number> {
  const { rowCount } = await tx.query(
    `delete from app.child_sessions
      where coalesce(revoked_at, expires_at) < now() - make_interval(days => $1)`,
    [olderThanDays],
  );
  return rowCount ?? 0;
}

export async function insertAdultGrant(
  tx: Tx,
  input: {
    accountId: string;
    tokenHash: string;
    action: string;
    targetId: string;
    expiresAt: Date;
  },
): Promise<void> {
  await tx.query(
    `insert into app.adult_action_grants (account_id, token_hash, action, target_id, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [input.accountId, input.tokenHash, input.action, input.targetId, input.expiresAt],
  );
}

/** Atomically consumes a grant that matches account, action and target. */
export async function consumeAdultGrant(
  tx: Tx,
  input: { accountId: string; tokenHash: string; action: string; targetId: string },
): Promise<boolean> {
  const { rowCount } = await tx.query(
    `update app.adult_action_grants set consumed_at = now()
      where token_hash = $1 and account_id = $2 and action = $3 and target_id = $4
        and consumed_at is null and expires_at > now()`,
    [input.tokenHash, input.accountId, input.action, input.targetId],
  );
  return (rowCount ?? 0) === 1;
}

export async function purgeExpiredGrants(tx: Tx, olderThanDays: number): Promise<number> {
  const { rowCount } = await tx.query(
    `delete from app.adult_action_grants where expires_at < now() - make_interval(days => $1)`,
    [olderThanDays],
  );
  return rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Staff roles
// ---------------------------------------------------------------------------

export async function activeStaffRoles(tx: Tx, accountId: string): Promise<string[]> {
  const { rows } = await tx.query<{ role: string }>(
    `select r.role from app.staff_roles r
       join app.accounts a on a.id = r.account_id
      where r.account_id = $1 and r.active and a.status = 'active'
      order by r.role`,
    [accountId],
  );
  return rows.map((r) => r.role);
}

export async function listStaff(tx: Tx) {
  const { rows } = await tx.query<{ accountId: string; role: string; active: boolean }>(
    `select account_id as "accountId", role, active from app.staff_roles
      order by account_id, role`,
  );
  return rows;
}

export async function upsertStaffRole(
  tx: Tx,
  input: { accountId: string; role: string; active: boolean },
): Promise<void> {
  await tx.query(
    `insert into app.staff_roles (account_id, role, active) values ($1, $2, $3)
     on conflict (account_id, role) do update set active = excluded.active`,
    [input.accountId, input.role, input.active],
  );
}

/** Accounts with active reminder consent for at least one child (weekly parent summaries). */
export async function accountsWithReminderConsent(
  tx: Tx,
): Promise<Array<{ accountId: string; studentId: string; nickname: string; timezone: string }>> {
  const { rows } = await tx.query<{
    accountId: string;
    studentId: string;
    nickname: string;
    timezone: string;
  }>(
    `select distinct c.account_id as "accountId", s.id as "studentId", s.nickname, s.timezone
       from app.consent_records c
       join app.students s on s.id = c.student_id and s.status = 'active'
       join app.accounts a on a.id = c.account_id and a.status = 'active'
      where c.purpose = 'parent_reminders' and c.withdrawn_at is null
      order by 1, 2`,
  );
  return rows;
}

export async function purgeRevokedPushTokens(tx: Tx, olderThanDays: number): Promise<number> {
  const { rowCount } = await tx.query(
    `delete from app.device_push_tokens where revoked_at < now() - make_interval(days => $1)`,
    [olderThanDays],
  );
  return rowCount ?? 0;
}
