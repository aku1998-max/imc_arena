import { withTx } from '@imc/db';
import { billingService, jobs, productDefaults } from '@imc/domain';
import { asOwner } from '@imc/testing';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  completeSession,
  createFamily,
  createTestEnv,
  resetData,
  seedQuestions,
  setFlag,
  startSession,
  urls,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;

beforeAll(async () => {
  await resetData();
  env = await createTestEnv({ BILLING_PRODUCT_IDS: 'imc_pro_monthly' });
  await seedQuestions(env, 3);
});
afterAll(async () => env.close());

const q = <T = any>(sql: string, params: unknown[] = []) =>
  asOwner(urls.migrationUrl, async (c) => (await c.query(sql, params)).rows as T[]);

describe('durable jobs', () => {
  it('a worker crash mid-job is recovered via lease expiry without duplicate grants', async () => {
    await setFlag('billing', true);
    const f = await createFamily(env);
    const [{ billing_customer_id: customer }] = await q(
      `select billing_customer_id from app.accounts where id = $1`,
      [f.parentId],
    );
    const g = await call(env, 'POST', '/v1/adult-grants', {
      token: f.parent,
      body: { action: 'purchase', targetId: f.studentId },
    });
    await call(env, 'POST', '/v1/billing/purchase-intents', {
      token: f.parent,
      body: { studentId: f.studentId, productId: 'imc_pro_monthly' },
      headers: { 'x-adult-grant': g.body.data.grant },
    });
    env.deps.billing.setSubscription(customer, {
      originalTransactionId: 'txn-crash',
      productId: 'imc_pro_monthly',
      status: 'active',
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      graceExpiresAt: null,
    });
    await call(env, 'POST', '/webhooks/revenuecat', {
      body: { event: { id: 'evt-crash', type: 'INITIAL_PURCHASE', app_user_id: customer } },
      headers: { authorization: `Bearer ${env.config.BILLING_WEBHOOK_SECRET}` },
    });
    // Worker #1 claims the job and performs the external work, then "crashes" before completing.
    const claimed = await withTx(env.deps.pool, { type: 'system', reason: 'test' }, (tx) =>
      import('@imc/db').then(({ ops }) => ops.claimJobs(tx, { limit: 10, leaseSeconds: 60 })),
    );
    const job = claimed.find((j) => j.type === 'billing.event')!;
    await billingService.processBillingEvent(env.deps.pool, env.deps.billing, job.payload as never);
    // While the lease is valid no other worker can take it.
    expect((await jobs.runJobsOnce(env.deps, { limit: 10 })).claimed).toBe(0);
    // Lease expires; worker #2 reclaims and re-runs the idempotent handler.
    await q(`update app.outbox_jobs set lease_until = now() - interval '1 second' where id = $1`, [
      job.id,
    ]);
    const run = await jobs.runJobsOnce(env.deps, { limit: 10 });
    expect(run.done).toBeGreaterThanOrEqual(1);
    const ents = await q(`select * from app.entitlements where student_id = $1`, [f.studentId]);
    expect(ents).toHaveLength(1);
    const [row] = await q(`select status, attempts from app.outbox_jobs where id = $1`, [job.id]);
    expect(row).toEqual({ status: 'done', attempts: 2 });
  });

  it('retries with backoff and dead-letters after the configured attempts', async () => {
    await q(
      `insert into app.outbox_jobs (type, dedupe_key) values ('test.unknown', 'dead-letter-test')`,
    );
    for (let i = 0; i < productDefaults.jobMaxAttempts; i++) {
      await q(`update app.outbox_jobs set run_at = now() where dedupe_key = 'dead-letter-test'`);
      await jobs.runJobsOnce(env.deps);
      const [row] = await q(
        `select status, run_at > now() as delayed from app.outbox_jobs where dedupe_key = 'dead-letter-test'`,
      );
      if (i < productDefaults.jobMaxAttempts - 1)
        expect(row).toEqual({ status: 'pending', delayed: true });
    }
    const [row] = await q(
      `select status, attempts, last_error from app.outbox_jobs where dedupe_key = 'dead-letter-test'`,
    );
    expect(row.status).toBe('dead');
    expect(row.attempts).toBe(productDefaults.jobMaxAttempts);
    const alerts = await q(`select kind from app.ops_alerts where kind = 'job_dead_letter'`);
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(jobs.backoffDelayMs(1)).toBe(30_000);
    expect(jobs.backoffDelayMs(20)).toBe(3_600_000);
  });

  it('refreshes the progress projection after a completed session', async () => {
    const f = await createFamily(env);
    const s = await startSession(env, f);
    await completeSession(env, f, s.body.data.sessionId, 'correct');
    await jobs.runJobsOnce(env.deps);
    const rows = await q(
      `select completed_sessions, first_attempt_count, correct_count from app.progress_daily where student_id = $1`,
      [f.studentId],
    );
    expect(rows).toEqual([{ completed_sessions: 1, first_attempt_count: 5, correct_count: 5 }]);
  });
});

describe('data rights', () => {
  it('export produces a private object with a short-lived link', async () => {
    const f = await createFamily(env);
    const s = await startSession(env, f);
    await completeSession(env, f, s.body.data.sessionId, 'wrong');
    const g = await call(env, 'POST', '/v1/adult-grants', {
      token: f.parent,
      body: { action: 'export', targetId: f.studentId },
    });
    const e = await call(env, 'POST', '/v1/exports', {
      token: f.parent,
      body: { studentId: f.studentId },
      headers: { 'x-adult-grant': g.body.data.grant },
    });
    expect(e.body.data.status).toBe('pending');
    await jobs.runJobsOnce(env.deps);
    const ready = await call(env, 'GET', `/v1/exports/${e.body.data.exportId}`, {
      token: f.parent,
    });
    expect(ready.body.data.status).toBe('ready');
    const expiresIn = new Date(ready.body.data.expiresAt).getTime() - Date.now();
    expect(expiresIn).toBeLessThanOrEqual(productDefaults.signedUrlSeconds * 1000);
    const u = new URL(ready.body.data.downloadUrl);
    const file = await env.app.inject({ method: 'GET', url: u.pathname + u.search });
    const body = JSON.parse(file.body);
    expect(body.profile[0].id).toBe(f.studentId);
    expect(body.attempts).toHaveLength(5);
    expect(file.body).not.toContain('token_hash');
    // Another family cannot read the export record.
    const other = await createFamily(env);
    expect(
      (await call(env, 'GET', `/v1/exports/${e.body.data.exportId}`, { token: other.parent }))
        .status,
    ).toBe(404);
  });

  it('student deletion stops tokens immediately and the job removes history and private objects', async () => {
    const f = await createFamily(env);
    const s = await startSession(env, f);
    await completeSession(env, f, s.body.data.sessionId, 'wrong');
    await call(env, 'POST', '/v1/reports', {
      token: f.child,
      body: { category: 'other', message: 'my name is Kid' },
    });
    // Leave an export object behind to prove storage purge.
    const g1 = await call(env, 'POST', '/v1/adult-grants', {
      token: f.parent,
      body: { action: 'export', targetId: f.studentId },
    });
    await call(env, 'POST', '/v1/exports', {
      token: f.parent,
      body: { studentId: f.studentId },
      headers: { 'x-adult-grant': g1.body.data.grant },
    });
    await jobs.runJobsOnce(env.deps);
    const [{ object_key: exportKey }] = await q(
      `select object_key from app.data_exports where student_id = $1`,
      [f.studentId],
    );
    const exportPath = join(env.config.STORAGE_LOCAL_DIR, exportKey);
    expect(existsSync(exportPath)).toBe(true);

    const g = await call(env, 'POST', '/v1/adult-grants', {
      token: f.parent,
      body: { action: 'delete_student', targetId: f.studentId },
    });
    const d = await call(env, 'POST', '/v1/deletion-requests', {
      token: f.parent,
      body: { scope: 'student', studentId: f.studentId },
      headers: { 'x-adult-grant': g.body.data.grant },
    });
    expect(d.status).toBe(202);
    expect(d.body.data.notice).toMatch(/store/);
    // Immediately: child token dead, profile no longer usable.
    expect((await call(env, 'GET', '/v1/me', { token: f.child })).status).toBe(401);
    await jobs.runJobsOnce(env.deps);
    for (const table of [
      'students',
      'practice_sessions',
      'attempts',
      'review_items',
      'reward_events',
      'child_sessions',
      'consent_records',
      'data_exports',
    ]) {
      const col = table === 'students' ? 'id' : 'student_id';
      const rows = await q(`select 1 from app.${table} where ${col} = $1`, [f.studentId]);
      expect(rows, table).toHaveLength(0);
    }
    expect(
      await q(`select 1 from app.support_reports where message like '%my name is Kid%'`),
    ).toHaveLength(0);
    expect(
      await q(`select 1 from app.analytics_events where subject_id = $1`, [f.studentId]),
    ).toHaveLength(0);
    expect(existsSync(exportPath)).toBe(false);
    const [req] = await q(`select status from app.deletion_requests where id = $1`, [
      d.body.data.requestId,
    ]);
    expect(req.status).toBe('completed');
    // The job row no longer carries the payload.
    const [job] = await q(`select payload from app.outbox_jobs where dedupe_key = $1`, [
      `deletion:${d.body.data.requestId}`,
    ]);
    expect(job.payload).toEqual({});
    // The parent account remains.
    expect(
      (await call(env, 'GET', '/v1/students', { token: f.parent })).body.data.students,
    ).toEqual([]);
  });

  it('account deletion removes the account, its children and the Auth identity, then notifies', async () => {
    const f = await createFamily(env);
    env.deps.authAdmin.emails.set(f.parentId, 'parent@example.test');
    const g = await call(env, 'POST', '/v1/adult-grants', {
      token: f.parent,
      body: { action: 'delete_account', targetId: f.parentId },
    });
    const d = await call(env, 'POST', '/v1/deletion-requests', {
      token: f.parent,
      body: { scope: 'account', accountId: f.parentId },
      headers: { 'x-adult-grant': g.body.data.grant },
    });
    expect(d.status).toBe(202);
    // Account is closing: further parent calls are refused.
    expect((await call(env, 'GET', '/v1/students', { token: f.parent })).status).toBe(403);
    await jobs.runJobsOnce(env.deps);
    expect(await q(`select 1 from app.accounts where id = $1`, [f.parentId])).toHaveLength(0);
    expect(await q(`select 1 from app.students where id = $1`, [f.studentId])).toHaveLength(0);
    expect(env.deps.authAdmin.deleted).toContain(f.parentId);
    expect(env.deps.email.sent.find((m) => m.template === 'deletion_complete')?.to).toBe(
      'parent@example.test',
    );
  });
});
