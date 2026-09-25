import { ops, type Tx } from '@imc/db';
import { DomainError } from '../errors.js';

export function actorLabel(tx: Tx): string {
  const p = tx.principal;
  switch (p.type) {
    case 'child':
      return `child:${p.studentId}`;
    case 'adult':
      return `adult:${p.accountId}`;
    case 'staff':
      return `staff:${p.accountId}`;
    case 'system':
      return `system:${p.reason}`;
    default:
      return 'anonymous';
  }
}

export function requireAdult(tx: Tx): string {
  if (tx.principal.type !== 'adult') throw new DomainError('FORBIDDEN', 'Parent access required.');
  return tx.principal.accountId;
}

export function requireChild(tx: Tx): string {
  if (tx.principal.type !== 'child') throw new DomainError('FORBIDDEN', 'Child access required.');
  return tx.principal.studentId;
}

export function requireStaff(tx: Tx): string {
  if (tx.principal.type !== 'staff') throw new DomainError('FORBIDDEN', 'Staff access required.');
  return tx.principal.accountId;
}

export async function audit(
  tx: Tx,
  action: string,
  target: { type: string; id: string | null },
  opts: { reason?: string; metadata?: Record<string, unknown> } = {},
) {
  await ops.insertAudit(tx, {
    actor: actorLabel(tx),
    action,
    targetType: target.type,
    targetId: target.id,
    reason: opts.reason ?? null,
    metadata: opts.metadata ?? {},
  });
}

/** Analytics with safe, non-identifying properties only (see spec section 15). */
export async function track(
  tx: Tx,
  name:
    | 'account_created'
    | 'child_created'
    | 'session_started'
    | 'session_completed'
    | 'answer_recorded'
    | 'paywall_viewed'
    | 'purchase_verified'
    | 'content_reported'
    | 'import_failed',
  subjectId: string | null,
  properties: Record<string, string | number | boolean | null>,
) {
  await ops.insertAnalyticsEvent(tx, { name, subjectId, properties });
}

export function encodeCursor(parts: string[]): string {
  return Buffer.from(JSON.stringify(parts)).toString('base64url');
}

export function decodeCursor(cursor: string | undefined, arity: number): string[] | undefined {
  if (!cursor) return undefined;
  try {
    const parts = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      Array.isArray(parts) &&
      parts.length === arity &&
      parts.every((p) => typeof p === 'string')
    ) {
      return parts as string[];
    }
  } catch {
    // fall through
  }
  throw new DomainError('VALIDATION_FAILED', 'Invalid cursor.');
}
