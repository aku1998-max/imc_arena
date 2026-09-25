import { bootstrapDatabase } from '../src/bootstrap.js';
import { loadDotEnv, requireEnv } from '../src/env.js';

loadDotEnv();
const reset = process.argv.includes('--reset');
if (reset && process.env.ENVIRONMENT === 'production') {
  throw new Error('Refusing to reset a production database');
}
await bootstrapDatabase({
  adminUrl: requireEnv('DATABASE_ADMIN_URL'),
  migrationUrl: requireEnv('DATABASE_MIGRATION_URL'),
  runtimeUrl: requireEnv('DATABASE_URL'),
  reset,
});
