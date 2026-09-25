import { loadDotEnv, requireEnv } from '@imc/db';
import pg from 'pg';

/**
 * Operator bootstrap for the first administrator (later roles are managed in the admin website).
 * Usage: pnpm --filter @imc/api staff:grant <account-uuid> <editor|reviewer|administrator|support> "<reason>"
 * Uses the migration/owner identity; run only with project-owner authorization.
 */
loadDotEnv();
const [accountId, role, reason] = process.argv.slice(2);
if (!accountId || !role || !reason) {
  console.error('usage: staff:grant <account-uuid> <role> "<reason>"');
  process.exit(1);
}
const client = new pg.Client({ connectionString: requireEnv('DATABASE_MIGRATION_URL') });
await client.connect();
try {
  await client.query('begin');
  const acct = await client.query('select 1 from app.accounts where id = $1', [accountId]);
  if (!acct.rowCount) throw new Error('account not found: the person must sign in once first');
  await client.query(
    `insert into app.staff_roles (account_id, role, active) values ($1, $2, true)
     on conflict (account_id, role) do update set active = true`,
    [accountId, role],
  );
  await client.query(
    `insert into app.audit_events (actor, action, target_type, target_id, reason, metadata)
     values ('operator:cli', 'staff_role.set', 'account', $1, $2, $3)`,
    [accountId, reason, JSON.stringify({ role, active: true })],
  );
  await client.query('commit');
  console.log(`granted ${role} to ${accountId}`);
} catch (err) {
  await client.query('rollback');
  throw err;
} finally {
  await client.end();
}
