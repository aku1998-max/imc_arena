import pg from 'pg';

// Dates stay as 'YYYY-MM-DD' strings; timestamps become ISO 8601 UTC strings with full
// (microsecond) precision so keyset cursors round-trip exactly.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
const parseTimestamp = pg.types.getTypeParser(pg.types.builtins.TIMESTAMPTZ);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)\+00$/.exec(v);
  if (m) return `${m[1]}T${m[2]}Z`;
  return (parseTimestamp(v) as Date).toISOString();
});
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error('bigint exceeds safe integer range');
  return n;
});

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    // Sessions run in UTC so timestamps serialize consistently.
    options: '-c timezone=UTC -c statement_timeout=15000',
  });
}
