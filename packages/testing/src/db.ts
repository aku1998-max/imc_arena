import { bootstrapDatabase, migrate } from '@imc/db';
import pg from 'pg';

export interface TestDatabaseUrls {
  adminUrl: string;
  migrationUrl: string;
  runtimeUrl: string;
}

/** Derives an isolated test database (same roles, different database name). */
export function testDatabaseUrls(
  env: NodeJS.ProcessEnv = process.env,
  name = 'imc_arena_test',
): TestDatabaseUrls {
  const swap = (url: string) => {
    const u = new URL(url);
    u.pathname = `/${name}`;
    return u.toString();
  };
  const admin = env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const migration =
    env.DATABASE_MIGRATION_URL ??
    'postgres://imc_owner:local-owner-password@localhost:5432/imc_arena';
  const runtime =
    env.DATABASE_URL ?? 'postgres://imc_api:local-runtime-password@localhost:5432/imc_arena';
  return { adminUrl: admin, migrationUrl: swap(migration), runtimeUrl: swap(runtime) };
}

/** Recreates the test database from scratch and applies every migration with the owner role. */
export async function resetTestDatabase(urls: TestDatabaseUrls) {
  await bootstrapDatabase({ ...urls, reset: true, log: () => {} });
  await migrate(urls.migrationUrl, () => {});
}

/** Truncates application data (owner connection) while keeping reference rows like flags. */
export async function truncateAppData(migrationUrl: string) {
  const client = new pg.Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ t: string }>(
      `select format('%I.%I', schemaname, tablename) as t from pg_tables
        where schemaname = 'app' and tablename <> 'feature_flags'`,
    );
    await client.query(`truncate ${rows.map((r) => r.t).join(', ')} cascade`);
    await client.query(`truncate private.answer_keys cascade`);
    await client.query(
      `update app.feature_flags set enabled = (key in ('new_sessions', 'answer_submissions'))`,
    );
  } finally {
    await client.end();
  }
}

/** Runs SQL as the owner role (test setup only, e.g. seeding staff roles). */
export async function asOwner<T>(
  migrationUrl: string,
  fn: (c: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
