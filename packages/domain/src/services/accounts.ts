import { randomUUID } from 'node:crypto';
import type { StudentProfile } from '@imc/contracts';
import { accounts, ops, type StudentRow, type Tx } from '@imc/db';
import { DomainError, notFound } from '../errors.js';
import { isValidTimezone } from '../time.js';
import { audit, requireAdult, track } from './common.js';
import { consumeAdultGrant } from './identity.js';

export function toStudentProfile(s: StudentRow): StudentProfile {
  return {
    id: s.id,
    nickname: s.nickname,
    avatarKey: s.avatarKey,
    grade: s.grade,
    locale: s.locale,
    timezone: s.timezone,
    status: s.status,
  };
}

/** Called after identity verification: creates the account row on first sign-in. */
export async function ensureAdultAccount(tx: Tx, locale = 'en') {
  const accountId = requireAdult(tx);
  const existing = await accounts.findAccount(tx, accountId);
  if (existing) return existing;
  const created = await accounts.ensureAccount(tx, accountId, locale);
  await track(tx, 'account_created', accountId, { onboardingStage: 'verified' });
  return created;
}

export async function createStudent(
  tx: Tx,
  input: { nickname: string; avatarKey: string; grade: number; timezone: string; locale: string },
) {
  const accountId = requireAdult(tx);
  if (!isValidTimezone(input.timezone))
    throw new DomainError('VALIDATION_FAILED', 'Unknown timezone.');
  const existing = await accounts.listStudentsForAccount(tx, accountId);
  if (existing.length >= 6) {
    throw new DomainError('CONFLICT', 'An account can manage at most six child profiles.');
  }
  const id = randomUUID();
  await accounts.insertStudentWithOwner(tx, { id, accountId, ...input });
  const student = await accounts.findStudent(tx, id);
  if (!student) throw new Error('student not visible after creation');
  await audit(tx, 'student.created', { type: 'student', id });
  await track(tx, 'child_created', id, { grade: input.grade, onboardingStage: 'profile' });
  return toStudentProfile(student);
}

export async function listStudents(tx: Tx) {
  const accountId = requireAdult(tx);
  return (await accounts.listStudentsForAccount(tx, accountId)).map(toStudentProfile);
}

/** Guardian-only profile edits; grade and timezone are parent-mode settings. */
export async function updateStudent(
  tx: Tx,
  studentId: string,
  patch: {
    nickname?: string;
    avatarKey?: string;
    grade?: number;
    timezone?: string;
    locale?: string;
  },
) {
  requireAdult(tx);
  const student = await accounts.findStudent(tx, studentId);
  if (!student || student.status !== 'active') throw notFound('Child profile');
  if (patch.timezone && !isValidTimezone(patch.timezone)) {
    throw new DomainError('VALIDATION_FAILED', 'Unknown timezone.');
  }
  await accounts.updateStudent(tx, studentId, patch);
  const changed = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined);
  await audit(tx, 'student.updated', { type: 'student', id: studentId }, { metadata: { changed } });
  return toStudentProfile((await accounts.findStudent(tx, studentId))!);
}

export async function recordConsent(
  tx: Tx,
  input: { studentId: string; purpose: string; policyVersion: string; granted: boolean },
) {
  const accountId = requireAdult(tx);
  const student = await accounts.findStudent(tx, input.studentId);
  if (!student) throw notFound('Child profile');
  if (input.granted) {
    const row = await accounts.insertConsent(tx, { accountId, ...input });
    await audit(
      tx,
      'consent.granted',
      { type: 'student', id: input.studentId },
      {
        metadata: { purpose: input.purpose, policyVersion: input.policyVersion },
      },
    );
    return [row];
  }
  const rows = await accounts.withdrawConsent(tx, { accountId, ...input });
  if (input.purpose === 'core_service') {
    // Without core consent the child can no longer use the service on any device.
    await accounts.revokeAllChildSessions(tx, input.studentId);
  }
  await audit(
    tx,
    'consent.withdrawn',
    { type: 'student', id: input.studentId },
    {
      metadata: { purpose: input.purpose },
    },
  );
  return rows;
}

export async function listConsents(tx: Tx) {
  const accountId = requireAdult(tx);
  return accounts.listConsents(tx, accountId);
}

export async function requestExport(
  tx: Tx,
  input: { studentId: string; grant: string | undefined },
) {
  const accountId = requireAdult(tx);
  const student = await accounts.findStudent(tx, input.studentId);
  if (!student) throw notFound('Child profile');
  await consumeAdultGrant(tx, input.grant, 'export', input.studentId);
  const id = randomUUID();
  await ops.insertExport(tx, { id, accountId, studentId: input.studentId });
  await ops.enqueueJob(tx, {
    type: 'export.generate',
    dedupeKey: `export:${id}`,
    payload: { exportId: id },
  });
  await audit(
    tx,
    'export.requested',
    { type: 'student', id: input.studentId },
    {
      metadata: { exportId: id },
    },
  );
  return { exportId: id, status: 'pending' as const, downloadUrl: null, expiresAt: null };
}

export async function getExport(
  tx: Tx,
  exportId: string,
  sign: (objectKey: string) => Promise<{ url: string; expiresAt: Date }>,
) {
  requireAdult(tx);
  const row = await ops.findExport(tx, exportId);
  if (!row) throw notFound('Export');
  if (row.status === 'ready' && row.objectKey) {
    const signed = await sign(row.objectKey);
    return {
      exportId: row.id,
      status: row.status,
      downloadUrl: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }
  return { exportId: row.id, status: row.status, downloadUrl: null, expiresAt: null };
}

/**
 * Deletion: fresh grant -> confirm target -> revoke sessions immediately -> enqueue purge.
 * The purge job removes application/storage data and, for account closure, the Auth identity.
 */
export async function requestDeletion(
  tx: Tx,
  input:
    | { scope: 'student'; studentId: string; grant: string | undefined }
    | { scope: 'account'; accountId: string; grant: string | undefined },
) {
  const accountId = requireAdult(tx);
  const targetId = input.scope === 'student' ? input.studentId : input.accountId;
  let studentIds: string[];
  if (input.scope === 'student') {
    const student = await accounts.findStudent(tx, input.studentId);
    if (!student) throw notFound('Child profile');
    studentIds = [student.id];
  } else {
    if (input.accountId !== accountId) throw notFound('Account');
    studentIds = (await accounts.listStudentsForAccount(tx, accountId)).map((s) => s.id);
  }
  await consumeAdultGrant(
    tx,
    input.grant,
    input.scope === 'student' ? 'delete_student' : 'delete_account',
    targetId,
  );
  for (const sid of studentIds) {
    await accounts.revokeAllChildSessions(tx, sid);
    await accounts.setStudentStatus(tx, sid, 'deleting');
  }
  if (input.scope === 'account') await accounts.setAccountStatus(tx, accountId, 'deleting');
  const requestId = randomUUID();
  await ops.insertDeletionRequest(tx, { id: requestId, accountId, scope: input.scope, targetId });
  await ops.enqueueJob(tx, {
    type: 'deletion.execute',
    dedupeKey: `deletion:${requestId}`,
    payload: {
      requestId,
      scope: input.scope,
      accountId,
      studentIds,
    },
  });
  await audit(
    tx,
    'deletion.requested',
    { type: input.scope, id: targetId },
    {
      metadata: { requestId, studentCount: studentIds.length },
    },
  );
  return {
    requestId,
    status: 'pending' as const,
    notice:
      'Deletion has started and child devices were signed out. App store subscriptions must be cancelled separately in the store.',
  };
}
