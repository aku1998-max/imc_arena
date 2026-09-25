import type { Pool, PoolClient } from './pool.js';

export type PrincipalContext =
  | { type: 'child'; studentId: string; childSessionId: string }
  | { type: 'adult'; accountId: string }
  | { type: 'staff'; accountId: string }
  | { type: 'system'; reason: string }
  /** Pre-authentication lookups (e.g. resolving a child token). Sees no application rows. */
  | { type: 'anonymous' };

/** A client bound to one transaction with transaction-local principal settings. */
export type Tx = PoolClient & { readonly principal: PrincipalContext };

/**
 * Runs `fn` inside BEGIN ... COMMIT on a single pooled connection. Principal settings are
 * applied with set_config(..., true) so they vanish at transaction end and never leak to the
 * next borrower of the connection. Identity always comes from verified authentication, never
 * from request bodies.
 */
export async function withTx<T>(
  pool: Pool,
  principal: PrincipalContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    await client.query(
      `select set_config('app.principal_type', $1, true),
              set_config('app.account_id', $2, true),
              set_config('app.student_id', $3, true)`,
      [
        principal.type,
        principal.type === 'adult' || principal.type === 'staff' ? principal.accountId : '',
        principal.type === 'child' ? principal.studentId : '',
      ],
    );
    const tx = Object.assign(client, { principal }) as Tx;
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Connection is broken; destroy it instead of returning it to the pool.
      client.release(err as Error);
      released = true;
    }
    throw err;
  } finally {
    if (!released) client.release();
  }
}

/** Serialization failures and deadlocks are safe to retry for idempotent units of work. */
export function isRetryableTxError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === '40001' || code === '40P01';
}

export function pgErrorCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}

export function pgConstraint(err: unknown): string | undefined {
  return (err as { constraint?: string } | null)?.constraint;
}
