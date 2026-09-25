import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies pending SQL migrations in filename order, each in its own transaction, using the
 * migration/owner identity (never the runtime identity). Applied files are checksummed; editing
 * an applied migration is an error; add a new migration instead.
 */
export async function migrate(
  connectionString: string,
  log = console.log,
): Promise<MigrationResult> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query('select pg_advisory_lock(727274)');
    await client.query(`create schema if not exists private`);
    await client.query(`create table if not exists private.schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
    const { rows } = await client.query<{ name: string; checksum: string }>(
      'select name, checksum from private.schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{4}_.+\.sql$/.test(f))
      .sort();
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.get(file);
      if (previous) {
        if (previous !== checksum) {
          throw new Error(`Migration ${file} was modified after being applied`);
        }
        result.skipped.push(file);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'insert into private.schema_migrations (name, checksum) values ($1, $2)',
          [file, checksum],
        );
        await client.query('COMMIT');
        result.applied.push(file);
        log(`applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(727274)').catch(() => undefined);
    await client.end();
  }
  return result;
}
