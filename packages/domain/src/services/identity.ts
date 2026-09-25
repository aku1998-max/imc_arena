import type { GrantAction } from '@imc/contracts';
import { accounts, type Pool, type Tx, withTx } from '@imc/db';
import { productDefaults } from '../config.js';
import { randomToken, sha256Hex } from '../crypto.js';
import { DomainError, notFound } from '../errors.js';
import { audit, requireAdult } from './common.js';

export function hashToken(token: string): string {
  return sha256Hex(`imc-token-v1:${token}`);
}

/** Resolves an opaque child bearer token. Returns null when unknown, expired or revoked. */
export async function authenticateChildToken(pool: Pool, token: string) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) return null;
  const hash = hashToken(token);
  const session = await withTx(pool, { type: 'anonymous' }, (tx) =>
    accounts.resolveChildSession(tx, hash),
  );
  if (!session) return null;
  await withTx(
    pool,
    { type: 'child', studentId: session.studentId, childSessionId: session.sessionId },
    (tx) => accounts.touchChildSession(tx, session.sessionId),
  );
  return session;
}

/** Guardian issues a child-mode session for one student and one device label. */
export async function createChildSession(
  tx: Tx,
  input: { studentId: string; deviceLabel: string },
  now = new Date(),
) {
  const accountId = requireAdult(tx);
  const student = await accounts.findStudent(tx, input.studentId);
  if (!student || student.status !== 'active') throw notFound('Child profile');
  if (!(await accounts.hasActiveConsent(tx, student.id, 'core_service'))) {
    throw new DomainError('FORBIDDEN', 'Parental consent is required before child mode.');
  }
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + productDefaults.childSessionDays * 86_400_000);
  const row = await accounts.insertChildSession(tx, {
    studentId: student.id,
    createdBy: accountId,
    tokenHash: hashToken(token),
    deviceLabel: input.deviceLabel,
    expiresAt,
  });
  await audit(
    tx,
    'child_session.created',
    { type: 'student', id: student.id },
    {
      metadata: { childSessionId: row.id },
    },
  );
  return { sessionId: row.id, token, expiresAt: row.expiresAt };
}

export async function listDevices(tx: Tx, studentId: string) {
  requireAdult(tx);
  const student = await accounts.findStudent(tx, studentId);
  if (!student) throw notFound('Child profile');
  return accounts.listChildSessions(tx, studentId);
}

export async function revokeChildSession(tx: Tx, childSessionId: string) {
  requireAdult(tx);
  const row = await accounts.findChildSession(tx, childSessionId);
  if (!row) throw notFound('Device session');
  await accounts.revokeChildSession(tx, row.id);
  await audit(
    tx,
    'child_session.revoked',
    { type: 'student', id: row.studentId },
    {
      metadata: { childSessionId: row.id },
    },
  );
}

/**
 * Issues a short-lived, single-use, action-scoped grant. The caller (API) has already verified
 * that the adult's authentication is fresh (recent OTP); a stale JWT alone never gets here.
 */
export async function createAdultGrant(
  tx: Tx,
  input: { action: GrantAction; targetId: string },
  now = new Date(),
) {
  const accountId = requireAdult(tx);
  if (input.action === 'delete_account') {
    if (input.targetId !== accountId) throw notFound('Account');
  } else {
    const student = await accounts.findStudent(tx, input.targetId);
    if (!student) throw notFound('Child profile');
  }
  const grant = randomToken(32);
  const expiresAt = new Date(now.getTime() + productDefaults.adultGrantMinutes * 60_000);
  await accounts.insertAdultGrant(tx, {
    accountId,
    tokenHash: hashToken(grant),
    action: input.action,
    targetId: input.targetId,
    expiresAt,
  });
  return { grant, expiresAt: expiresAt.toISOString() };
}

/** Consumes a grant for exactly this action and target, or fails with REAUTH_REQUIRED. */
export async function consumeAdultGrant(
  tx: Tx,
  grant: string | undefined,
  action: GrantAction,
  targetId: string,
) {
  const accountId = requireAdult(tx);
  if (!grant) {
    throw new DomainError('REAUTH_REQUIRED', 'Please confirm it is you before continuing.');
  }
  const ok = await accounts.consumeAdultGrant(tx, {
    accountId,
    tokenHash: hashToken(grant),
    action,
    targetId,
  });
  if (!ok) throw new DomainError('REAUTH_REQUIRED', 'Please confirm it is you before continuing.');
}
