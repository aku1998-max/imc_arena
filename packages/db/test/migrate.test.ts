import pg from 'pg';
import { beforeAll, expect, it } from 'vitest';
import { bootstrapDatabase } from '../src/bootstrap.js';
import { loadDotEnv } from '../src/env.js';
import { migrate } from '../src/migrate.js';

loadDotEnv();
const swap = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};
const DB = 'imc_arena_migrate_test';
const urls = {
  adminUrl:
    process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres',
  migrationUrl: swap(
    process.env.DATABASE_MIGRATION_URL ??
      'postgres://imc_owner:local-owner-password@localhost:5432/x',
    DB,
  ),
  runtimeUrl: swap(
    process.env.DATABASE_URL ?? 'postgres://imc_api:local-runtime-password@localhost:5432/x',
    DB,
  ),
};

beforeAll(async () => {
  await bootstrapDatabase({ ...urls, reset: true, log: () => {} });
}, 60_000);

it('applies all migrations to a clean database and is idempotent', async () => {
  const first = await migrate(urls.migrationUrl, () => {});
  expect(first.applied.length).toBeGreaterThanOrEqual(5);
  const second = await migrate(urls.migrationUrl, () => {});
  expect(second.applied).toEqual([]);
  expect(second.skipped).toEqual(first.applied);
});

it('forces row-level security on every application table', async () => {
  const c = new pg.Client({ connectionString: urls.migrationUrl });
  await c.connect();
  const { rows } = await c.query<{ relname: string; forced: boolean; enabled: boolean }>(
    `select c.relname, c.relforcerowsecurity as forced, c.relrowsecurity as enabled
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relkind = 'r'`,
  );
  await c.end();
  expect(rows.length).toBeGreaterThan(20);
  expect(rows.filter((r) => !r.forced || !r.enabled).map((r) => r.relname)).toEqual([]);
});

it('keeps the runtime identity separate from the migration identity', async () => {
  await expect(
    bootstrapDatabase({ ...urls, runtimeUrl: urls.migrationUrl, log: () => {} }),
  ).rejects.toThrow(/must differ/);
  const c = new pg.Client({ connectionString: urls.runtimeUrl });
  await c.connect();
  await expect(c.query('create table app.nope (id int)')).rejects.toThrow(/permission denied/);
  await expect(c.query('select * from private.schema_migrations')).rejects.toThrow(
    /permission denied/,
  );
  await c.end();
});
