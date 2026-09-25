import type { Tx } from '../context.js';

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

export type IdempotencyClaim =
  | { kind: 'new' }
  | { kind: 'replay'; statusCode: number; response: unknown }
  | { kind: 'mismatch' };

/**
 * Claims principal+route+key inside the caller's transaction. A concurrent request with the same
 * key blocks on the unique index until the first transaction commits (then replays) or rolls back
 * (then proceeds as new).
 */
export async function claimIdempotencyKey(
  tx: Tx,
  input: { principalId: string; route: string; key: string; requestHash: string; ttlHours: number },
): Promise<IdempotencyClaim> {
  const inserted = await tx.query(
    `insert into app.idempotency_keys (principal_id, route, key, request_hash, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(hours => $5))
     on conflict (principal_id, route, key) do nothing`,
    [input.principalId, input.route, input.key, input.requestHash, input.ttlHours],
  );
  if (inserted.rowCount === 1) return { kind: 'new' };
  const { rows } = await tx.query<{
    requestHash: string;
    statusCode: number | null;
    response: unknown;
    expired: boolean;
  }>(
    `select request_hash as "requestHash", status_code as "statusCode", response_json as response,
            expires_at < now() as expired
       from app.idempotency_keys where principal_id = $1 and route = $2 and key = $3 for update`,
    [input.principalId, input.route, input.key],
  );
  const row = rows[0];
  if (!row || row.expired) {
    await tx.query(
      `update app.idempotency_keys set request_hash = $4, status_code = null, response_json = null,
              expires_at = now() + make_interval(hours => $5)
        where principal_id = $1 and route = $2 and key = $3`,
      [input.principalId, input.route, input.key, input.requestHash, input.ttlHours],
    );
    return { kind: 'new' };
  }
  if (row.requestHash !== input.requestHash) return { kind: 'mismatch' };
  if (row.statusCode === null) return { kind: 'new' };
  return { kind: 'replay', statusCode: row.statusCode, response: row.response };
}

export async function storeIdempotentResponse(
  tx: Tx,
  input: { principalId: string; route: string; key: string; statusCode: number; response: unknown },
) {
  await tx.query(
    `update app.idempotency_keys set status_code = $4, response_json = $5
      where principal_id = $1 and route = $2 and key = $3`,
    [input.principalId, input.route, input.key, input.statusCode, JSON.stringify(input.response)],
  );
}

export async function purgeExpiredIdempotencyKeys(tx: Tx): Promise<number> {
  const { rowCount } = await tx.query(`delete from app.idempotency_keys where expires_at < now()`);
  return rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Outbox jobs
// ---------------------------------------------------------------------------

export async function enqueueJob(
  tx: Tx,
  input: { type: string; dedupeKey: string; payload?: unknown; runAt?: Date },
): Promise<boolean> {
  const { rows } = await tx.query<{ created: boolean }>(
    `select app.enqueue_job($1, $2, $3, $4) as created`,
    [input.type, input.dedupeKey, JSON.stringify(input.payload ?? {}), input.runAt ?? null],
  );
  return rows[0]?.created ?? false;
}

export interface JobRow {
  id: string;
  type: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Claims due jobs (or jobs whose lease expired) with SKIP LOCKED and sets a lease. */
export async function claimJobs(tx: Tx, input: { limit: number; leaseSeconds: number }) {
  const { rows } = await tx.query<JobRow>(
    `update app.outbox_jobs j set status = 'running', attempts = j.attempts + 1,
            lease_until = now() + make_interval(secs => $2)
      where j.id in (
        select id from app.outbox_jobs
         where (status = 'pending' and run_at <= now())
            or (status = 'running' and lease_until < now())
         order by run_at
         limit $1
         for update skip locked)
      returning j.id, j.type, j.dedupe_key as "dedupeKey", j.payload, j.attempts`,
    [input.limit, input.leaseSeconds],
  );
  return rows;
}

export async function completeJob(tx: Tx, id: string, clearPayload = false) {
  await tx.query(
    `update app.outbox_jobs set status = 'done', lease_until = null, last_error = null,
            payload = case when $2 then '{}'::jsonb else payload end
      where id = $1`,
    [id, clearPayload],
  );
}

export async function failJob(
  tx: Tx,
  input: { id: string; error: string; retryAt: Date | null },
): Promise<void> {
  await tx.query(
    `update app.outbox_jobs set
        status = case when $3::timestamptz is null then 'dead' else 'pending' end,
        run_at = coalesce($3, run_at), lease_until = null, last_error = left($2, 1000)
      where id = $1`,
    [input.id, input.error, input.retryAt],
  );
}

export async function jobCounts(tx: Tx) {
  const { rows } = await tx.query<{ pending: number; dead: number }>(
    `select count(*) filter (where status in ('pending', 'running'))::int as pending,
            count(*) filter (where status = 'dead')::int as dead
       from app.outbox_jobs`,
  );
  return rows[0] ?? { pending: 0, dead: 0 };
}

export async function findJobByDedupeKey(tx: Tx, dedupeKey: string) {
  const { rows } = await tx.query<{ status: string; attempts: number; lastError: string | null }>(
    `select status, attempts, last_error as "lastError" from app.outbox_jobs where dedupe_key = $1`,
    [dedupeKey],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Audit, analytics, alerts, flags
// ---------------------------------------------------------------------------

export async function insertAudit(
  tx: Tx,
  input: {
    actor: string;
    action: string;
    targetType: string;
    targetId: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.query(
    `insert into app.audit_events (actor, action, target_type, target_id, reason, metadata)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.actor,
      input.action,
      input.targetType,
      input.targetId,
      input.reason ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function listAudit(
  tx: Tx,
  input: {
    targetType?: string;
    targetId?: string;
    cursor?: { occurredAt: string; id: string };
    limit: number;
  },
) {
  const { rows } = await tx.query<{
    id: string;
    actor: string;
    action: string;
    targetType: string;
    targetId: string | null;
    reason: string | null;
    metadata: Record<string, unknown>;
    occurredAt: string;
  }>(
    `select id, actor, action, target_type as "targetType", target_id as "targetId", reason,
            metadata, occurred_at as "occurredAt"
       from app.audit_events
      where ($1::text is null or target_type = $1)
        and ($2::text is null or target_id = $2)
        and ($3::timestamptz is null or (occurred_at, id) < ($3, $4::uuid))
      order by occurred_at desc, id desc limit $5`,
    [
      input.targetType ?? null,
      input.targetId ?? null,
      input.cursor?.occurredAt ?? null,
      input.cursor?.id ?? null,
      input.limit,
    ],
  );
  return rows;
}

export async function insertAnalyticsEvent(
  tx: Tx,
  input: { name: string; subjectId: string | null; properties: Record<string, unknown> },
) {
  await tx.query(
    `insert into app.analytics_events (name, subject_id, properties) values ($1, $2, $3)`,
    [input.name, input.subjectId, JSON.stringify(input.properties)],
  );
}

export async function raiseOpsAlert(
  tx: Tx,
  input: { kind: string; dedupeKey: string; details: Record<string, unknown> },
) {
  await tx.query(
    `insert into app.ops_alerts (kind, dedupe_key, details) values ($1, $2, $3)
     on conflict (dedupe_key) do update set occurrences = app.ops_alerts.occurrences + 1,
       last_seen_at = now(), details = excluded.details`,
    [input.kind, input.dedupeKey, JSON.stringify(input.details)],
  );
}

export async function listOpsAlerts(tx: Tx, limit: number) {
  const { rows } = await tx.query<{
    kind: string;
    dedupeKey: string;
    occurrences: number;
    lastSeenAt: string;
  }>(
    `select kind, dedupe_key as "dedupeKey", occurrences, last_seen_at as "lastSeenAt"
       from app.ops_alerts where acknowledged_at is null order by last_seen_at desc limit $1`,
    [limit],
  );
  return rows;
}

export async function getFlags(tx: Tx): Promise<Record<string, boolean>> {
  const { rows } = await tx.query<{ key: string; enabled: boolean }>(
    `select key, enabled from app.feature_flags`,
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.enabled]));
}

export async function setFlag(tx: Tx, key: string, enabled: boolean) {
  await tx.query(`update app.feature_flags set enabled = $2, updated_at = now() where key = $1`, [
    key,
    enabled,
  ]);
}

// ---------------------------------------------------------------------------
// Support reports
// ---------------------------------------------------------------------------

export async function insertSupportReport(
  tx: Tx,
  input: {
    id: string;
    studentId: string | null;
    accountId: string | null;
    versionId: string | null;
    category: string;
    message: string | null;
  },
) {
  await tx.query(
    `insert into app.support_reports (id, student_id, account_id, version_id, category, message)
     values ($1, $2, $3, $4, $5, $6)`,
    [input.id, input.studentId, input.accountId, input.versionId, input.category, input.message],
  );
}

export interface SupportReportRow {
  id: string;
  category: string;
  versionId: string | null;
  message: string | null;
  status: 'open' | 'in_progress' | 'resolved' | 'dismissed';
  assignedTo: string | null;
  resolution: string | null;
  createdAt: string;
}

const REPORT_COLS = `id, category, version_id as "versionId", message, status,
  assigned_to as "assignedTo", resolution, created_at as "createdAt"`;

export async function listSupportReports(
  tx: Tx,
  input: { status?: string; cursor?: { createdAt: string; id: string }; limit: number },
) {
  const { rows } = await tx.query<SupportReportRow>(
    `select ${REPORT_COLS} from app.support_reports
      where ($1::text is null or status = $1)
        and ($2::timestamptz is null or (created_at, id) < ($2, $3::uuid))
      order by created_at desc, id desc limit $4`,
    [input.status ?? null, input.cursor?.createdAt ?? null, input.cursor?.id ?? null, input.limit],
  );
  return rows;
}

export async function updateSupportReport(
  tx: Tx,
  id: string,
  patch: { status?: string; assignedTo?: string; resolution?: string },
): Promise<SupportReportRow | null> {
  const { rows } = await tx.query<SupportReportRow>(
    `update app.support_reports set
        status = coalesce($2, status),
        assigned_to = coalesce($3, assigned_to),
        resolution = coalesce($4, resolution)
      where id = $1 returning ${REPORT_COLS}`,
    [id, patch.status ?? null, patch.assignedTo ?? null, patch.resolution ?? null],
  );
  return rows[0] ?? null;
}

export async function countRecentReports(
  tx: Tx,
  principal: { studentId?: string; accountId?: string },
  minutes: number,
): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `select count(*)::int as n from app.support_reports
      where created_at > now() - make_interval(mins => $3)
        and (student_id = $1 or account_id = $2)`,
    [principal.studentId ?? null, principal.accountId ?? null, minutes],
  );
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Data exports and deletion requests
// ---------------------------------------------------------------------------

export interface ExportRow {
  id: string;
  accountId: string;
  studentId: string;
  status: 'pending' | 'ready' | 'failed' | 'expired';
  objectKey: string | null;
  expiresAt: string | null;
}

const EXPORT_COLS = `id, account_id as "accountId", student_id as "studentId", status,
  object_key as "objectKey", expires_at as "expiresAt"`;

export async function insertExport(
  tx: Tx,
  input: { id: string; accountId: string; studentId: string },
) {
  await tx.query(`insert into app.data_exports (id, account_id, student_id) values ($1, $2, $3)`, [
    input.id,
    input.accountId,
    input.studentId,
  ]);
}

export async function findExport(tx: Tx, id: string): Promise<ExportRow | null> {
  const { rows } = await tx.query<ExportRow>(
    `select ${EXPORT_COLS} from app.data_exports where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function markExportReady(tx: Tx, id: string, objectKey: string, expiresAt: Date) {
  await tx.query(
    `update app.data_exports set status = 'ready', object_key = $2, expires_at = $3 where id = $1`,
    [id, objectKey, expiresAt],
  );
}

export async function expiredExports(tx: Tx) {
  const { rows } = await tx.query<ExportRow>(
    `select ${EXPORT_COLS} from app.data_exports where status = 'ready' and expires_at < now()`,
  );
  return rows;
}

export async function markExportExpired(tx: Tx, id: string) {
  await tx.query(
    `update app.data_exports set status = 'expired', object_key = null where id = $1`,
    [id],
  );
}

export async function exportObjectKeysForStudent(tx: Tx, studentId: string): Promise<string[]> {
  const { rows } = await tx.query<{ objectKey: string }>(
    `select object_key as "objectKey" from app.data_exports
      where student_id = $1 and object_key is not null`,
    [studentId],
  );
  return rows.map((r) => r.objectKey);
}

export async function insertDeletionRequest(
  tx: Tx,
  input: { id: string; accountId: string; scope: 'student' | 'account'; targetId: string },
) {
  await tx.query(
    `insert into app.deletion_requests (id, account_id, scope, target_id) values ($1, $2, $3, $4)`,
    [input.id, input.accountId, input.scope, input.targetId],
  );
}

export async function completeDeletionRequest(tx: Tx, id: string) {
  await tx.query(
    `update app.deletion_requests set status = 'completed', completed_at = now() where id = $1`,
    [id],
  );
}

/** Removes personal records that reference the student but do not cascade. */
export async function scrubStudentReferences(tx: Tx, studentId: string) {
  await tx.query(`delete from app.support_reports where student_id = $1`, [studentId]);
  await tx.query(`delete from app.analytics_events where subject_id = $1`, [studentId]);
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export async function operationalMetrics(tx: Tx, from: string, to: string) {
  const { rows } = await tx.query<{
    childrenCreated: number;
    activated: number;
    sessionsCompleted: number;
    answersRecorded: number;
    openReports: number;
  }>(
    `with children as (
       select subject_id, occurred_at from app.analytics_events
        where name = 'child_created' and occurred_at::date between $1 and $2
     )
     select
       (select count(*)::int from children) as "childrenCreated",
       (select count(*)::int from children c where exists (
          select 1 from app.analytics_events e
           where e.name = 'session_completed' and e.subject_id = c.subject_id
             and e.occurred_at between c.occurred_at and c.occurred_at + interval '7 days')) as activated,
       (select count(*)::int from app.analytics_events
         where name = 'session_completed' and occurred_at::date between $1 and $2) as "sessionsCompleted",
       (select count(*)::int from app.analytics_events
         where name = 'answer_recorded' and occurred_at::date between $1 and $2) as "answersRecorded",
       (select count(*)::int from app.support_reports where status in ('open', 'in_progress')) as "openReports"`,
    [from, to],
  );
  return rows[0]!;
}

export async function publishedInventoryByGrade(tx: Tx) {
  const { rows } = await tx.query<{ grade: number; published: number }>(
    `select g.grade, count(v.id)::int as published
       from (values (4), (5), (6)) as g(grade)
       left join app.question_versions v on v.grade = g.grade and v.state = 'published'
      group by g.grade order by g.grade`,
  );
  return rows;
}
