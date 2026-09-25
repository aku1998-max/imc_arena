import { createPool, withTx, ops } from '@imc/db';
import { LocalStorage, LogEmail, MockAuthAdmin, MockBilling, type Deps } from '@imc/domain';
import { resetTestDatabase, testDatabaseUrls } from '@imc/testing';
import { loadDotEnv } from '@imc/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Worker } from '../src/worker.js';

loadDotEnv();
const urls = testDatabaseUrls(process.env, 'imc_arena_worker_test');
const silent = { info: () => {}, warn: () => {}, error: () => {} };
let deps: Deps;

beforeAll(async () => {
  await resetTestDatabase(urls);
  deps = {
    pool: createPool(urls.runtimeUrl, 4),
    storage: new LocalStorage('/tmp/imc-worker-test', 'x'.repeat(32), 'http://localhost'),
    billing: new MockBilling('y'.repeat(32), false),
    email: new LogEmail(silent),
    authAdmin: new MockAuthAdmin(silent),
    log: silent,
  };
}, 120_000);
afterAll(async () => deps.pool.end());

it('schedules periodic jobs once per window and drains them', async () => {
  const worker = new Worker(deps, { pollMs: 10, scheduleEveryMs: 60_000, batchSize: 10 });
  const now = Date.parse('2026-09-25T10:00:00Z');
  await worker.tick(now);
  await worker.tick(now + 1000);
  const counts = await withTx(deps.pool, { type: 'system', reason: 'test' }, (tx) =>
    ops.jobCounts(tx),
  );
  expect(counts).toEqual({ pending: 0, dead: 0 });
  const rows = await withTx(
    deps.pool,
    { type: 'system', reason: 'test' },
    async (tx) => (await tx.query(`select type, status from app.outbox_jobs order by type`)).rows,
  );
  expect(rows).toEqual([
    { type: 'billing.sweep', status: 'done' },
    { type: 'export.purge', status: 'done' },
    { type: 'maintenance.purge', status: 'done' },
    { type: 'parent.summary', status: 'done' },
  ]);
});

it('stops promptly', async () => {
  const worker = new Worker(deps, { pollMs: 60_000, scheduleEveryMs: 60_000, batchSize: 10 });
  const running = worker.run();
  setTimeout(() => worker.stop(), 50);
  await expect(running).resolves.toBeUndefined();
});
