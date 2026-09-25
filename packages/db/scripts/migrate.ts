import { loadDotEnv, requireEnv } from '../src/env.js';
import { migrate } from '../src/migrate.js';

loadDotEnv();
const result = await migrate(requireEnv('DATABASE_MIGRATION_URL'));
console.log(
  `migrations applied: ${result.applied.length}, already applied: ${result.skipped.length}`,
);
