import { loadDotEnv, requireEnv } from '@imc/db';
import { consoleLogger } from '@imc/domain';
import { loadConfig } from '@imc/domain';
import { buildDeps } from '@imc/domain';
import { DEV_STAFF, seedContent, seedStaff } from '../src/seed.js';

loadDotEnv();
const config = loadConfig();
if (config.ENVIRONMENT === 'production')
  throw new Error('Refusing to seed synthetic data into production');
await seedStaff(requireEnv('DATABASE_MIGRATION_URL'));
const deps = buildDeps(config, { ...consoleLogger, info: () => {} });
try {
  const result = await seedContent(deps);
  console.log(
    `seeded: imported ${result.imported.createdCount} (duplicates ${result.imported.duplicateCount}), published by grade: ${result.published
      .map((p) => `g${p.grade}=${p.published}`)
      .join(' ')}`,
  );
  console.log(`dev staff accounts: ${JSON.stringify(DEV_STAFF)}`);
} finally {
  await deps.pool.end();
}
