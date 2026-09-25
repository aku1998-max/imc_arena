import { createPool, loadDotEnv, requireEnv, withTx } from '@imc/db';
import { billingService } from '@imc/domain';

/**
 * Grants an expiring pilot entitlement (Pro without purchase) to one child profile.
 * Usage: pnpm --filter @imc/api pilot:grant <student-uuid> <YYYY-MM-DD valid-until> <cohort>
 */
loadDotEnv();
const [studentId, until, cohort] = process.argv.slice(2);
if (!studentId || !until || !cohort) {
  console.error('usage: pilot:grant <student-uuid> <YYYY-MM-DD> <cohort>');
  process.exit(1);
}
const pool = createPool(requireEnv('DATABASE_URL'), 2);
try {
  await withTx(pool, { type: 'system', reason: `pilot-grant:${cohort}` }, (tx) =>
    billingService.grantPilotEntitlement(tx, {
      studentId,
      validUntil: new Date(`${until}T23:59:59Z`),
      cohort,
    }),
  );
  console.log(`pilot entitlement granted until ${until}`);
} finally {
  await pool.end();
}
