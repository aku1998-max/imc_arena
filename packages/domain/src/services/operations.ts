import { randomUUID } from 'node:crypto';
import { accounts, content, ops, pgErrorCode, type Tx } from '@imc/db';
import { productDefaults } from '../config.js';
import { DomainError, forbidden, notFound } from '../errors.js';
import { daysBetween } from '../time.js';
import { audit, decodeCursor, encodeCursor, requireStaff, track } from './common.js';

async function requireAnyRole(tx: Tx, ...roles: string[]) {
  const accountId = requireStaff(tx);
  const held = await accounts.activeStaffRoles(tx, accountId);
  if (!roles.some((r) => held.includes(r)))
    throw forbidden('Your staff role does not allow this action.');
  return held;
}

/** Child or adult reports a content/app problem. Length-limited and throttled. */
export async function createReport(
  tx: Tx,
  input: { category: string; versionId?: string | undefined; message?: string | undefined },
) {
  const p = tx.principal;
  if (p.type !== 'child' && p.type !== 'adult') throw forbidden();
  const recent = await ops.countRecentReports(
    tx,
    p.type === 'child' ? { studentId: p.studentId } : { accountId: p.accountId },
    60,
  );
  if (recent >= productDefaults.reportRateLimitPerHour) {
    throw new DomainError('RATE_LIMITED', 'Too many reports. Please try again later.');
  }
  if (input.versionId) {
    const v = await content.findVersion(tx, input.versionId);
    if (!v) throw notFound('Question');
  }
  const id = randomUUID();
  await ops.insertSupportReport(tx, {
    id,
    studentId: p.type === 'child' ? p.studentId : null,
    accountId: p.type === 'adult' ? p.accountId : null,
    versionId: input.versionId ?? null,
    category: input.category,
    message: input.message?.trim() || null,
  });
  await track(tx, 'content_reported', null, {
    category: input.category,
    contentVersion: input.versionId ?? null,
  });
  return { reportId: id };
}

export async function listReports(
  tx: Tx,
  input: { status?: string | undefined; cursor?: string | undefined; limit: number },
) {
  await requireAnyRole(tx, 'support', 'administrator', 'editor', 'reviewer');
  const cursor = decodeCursor(input.cursor, 2);
  const rows = await ops.listSupportReports(tx, {
    status: input.status,
    cursor: cursor ? { createdAt: cursor[0]!, id: cursor[1]! } : undefined,
    limit: input.limit + 1,
  });
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: rows.length > input.limit && last ? encodeCursor([last.createdAt, last.id]) : null,
  };
}

export async function updateReport(
  tx: Tx,
  reportId: string,
  input: {
    status?: string | undefined;
    assignToSelf?: boolean | undefined;
    resolution?: string | undefined;
    reason: string;
  },
) {
  const actor = requireStaff(tx);
  await requireAnyRole(tx, 'support', 'administrator', 'editor');
  const row = await ops.updateSupportReport(tx, reportId, {
    status: input.status,
    assignedTo: input.assignToSelf ? actor : undefined,
    resolution: input.resolution,
  });
  if (!row) throw notFound('Report');
  await audit(
    tx,
    'report.updated',
    { type: 'support_report', id: reportId },
    {
      reason: input.reason,
      metadata: { status: input.status ?? null, assigned: input.assignToSelf ?? false },
    },
  );
  return row;
}

export async function metrics(tx: Tx, input: { from: string; to: string }) {
  await requireAnyRole(tx, 'administrator');
  if (input.from > input.to || daysBetween(input.from, input.to) > 366) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid date range.');
  }
  const m = await ops.operationalMetrics(tx, input.from, input.to);
  const inventory = await ops.publishedInventoryByGrade(tx);
  const jobs = await ops.jobCounts(tx);
  return {
    from: input.from,
    to: input.to,
    ...m,
    contentInventory: inventory.map((i) => ({
      grade: i.grade,
      published: i.published,
      status:
        i.published >= 40
          ? 'healthy'
          : i.published >= productDefaults.dailyQuestionCount
            ? 'low'
            : 'insufficient',
    })),
    jobs,
    notes: [
      'Activation = first completed session within seven days of child creation (cohort: children created in range).',
      'Counts are operational measurements; higher practice scores are not causal evidence of learning.',
    ],
  };
}

export async function listAuditEvents(
  tx: Tx,
  input: {
    targetType?: string | undefined;
    targetId?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  },
) {
  await requireAnyRole(tx, 'administrator', 'support');
  const cursor = decodeCursor(input.cursor, 2);
  const rows = await ops.listAudit(tx, {
    targetType: input.targetType,
    targetId: input.targetId,
    cursor: cursor ? { occurredAt: cursor[0]!, id: cursor[1]! } : undefined,
    limit: input.limit + 1,
  });
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: rows.length > input.limit && last ? encodeCursor([last.occurredAt, last.id]) : null,
  };
}

export async function listStaff(tx: Tx) {
  await requireAnyRole(tx, 'administrator');
  return { staff: await accounts.listStaff(tx) };
}

export async function setStaffRole(
  tx: Tx,
  input: { accountId: string; role: string; active: boolean; reason: string },
) {
  const actor = requireStaff(tx);
  await requireAnyRole(tx, 'administrator');
  if (input.accountId === actor && input.role === 'administrator' && !input.active) {
    throw new DomainError('INVALID_STATE', 'You cannot remove your own administrator role.');
  }
  try {
    await tx.query('savepoint staff_role');
    await accounts.upsertStaffRole(tx, input);
    await tx.query('release savepoint staff_role');
  } catch (err) {
    // The account must exist (the person has signed in at least once).
    if (pgErrorCode(err) === '23503') {
      await tx.query('rollback to savepoint staff_role');
      throw notFound('Account');
    }
    throw err;
  }
  await audit(
    tx,
    'staff_role.set',
    { type: 'account', id: input.accountId },
    {
      reason: input.reason,
      metadata: { role: input.role, active: input.active },
    },
  );
}

export async function setFlag(tx: Tx, input: { key: string; enabled: boolean; reason: string }) {
  await requireAnyRole(tx, 'administrator');
  const flags = await ops.getFlags(tx);
  if (!(input.key in flags)) throw notFound('Flag');
  await ops.setFlag(tx, input.key, input.enabled);
  await audit(
    tx,
    'flag.set',
    { type: 'feature_flag', id: input.key },
    {
      reason: input.reason,
      metadata: { enabled: input.enabled },
    },
  );
}
