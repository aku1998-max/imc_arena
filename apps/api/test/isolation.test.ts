import { asOwner } from '@imc/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adultToken,
  call,
  completeSession,
  createFamily,
  createTestEnv,
  resetData,
  seedQuestions,
  startSession,
  staffToken,
  urls,
  type Family,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
let a: Family;
let b: Family;
let bSessionId: string;
let bItemId: string;

beforeAll(async () => {
  await resetData();
  env = await createTestEnv();
  await seedQuestions(env);
  a = await createFamily(env);
  b = await createFamily(env);
  const s = await startSession(env, b);
  bSessionId = s.body.data.sessionId;
  bItemId = s.body.data.nextItemId;
  await completeSession(env, b, bSessionId, 'wrong');
});
afterAll(async () => env.close());

describe('family isolation over HTTP', () => {
  it('parent A cannot read, modify, export or delete family B by changing ids', async () => {
    const reads = [
      `/v1/students/${b.studentId}/home`,
      `/v1/students/${b.studentId}/progress?from=2026-01-01&to=2026-12-31`,
      `/v1/students/${b.studentId}/mistakes`,
      `/v1/students/${b.studentId}/devices`,
      `/v1/sessions/${bSessionId}`,
      `/v1/sessions/${bSessionId}/items/${bItemId}`,
    ];
    for (const url of reads) {
      const r = await call(env, 'GET', url, { token: a.parent });
      expect(r.status, url).toBe(404);
    }
    const patch = await call(env, 'PATCH', `/v1/students/${b.studentId}`, {
      token: a.parent,
      body: { nickname: 'Hacked' },
    });
    expect(patch.status).toBe(404);
    const cs = await call(env, 'POST', `/v1/students/${b.studentId}/child-sessions`, {
      token: a.parent,
      body: { deviceLabel: 'evil' },
    });
    expect(cs.status).toBe(404);
    const revoke = await call(env, 'DELETE', `/v1/child-sessions/${b.childSessionId}`, {
      token: a.parent,
    });
    expect(revoke.status).toBe(404);
    const consent = await call(env, 'POST', '/v1/consents', {
      token: a.parent,
      body: { studentId: b.studentId, purpose: 'core_service', policyVersion: 'x', granted: false },
    });
    expect(consent.status).toBe(404);
    for (const action of ['export', 'delete_student', 'purchase'] as const) {
      const g = await call(env, 'POST', '/v1/adult-grants', {
        token: a.parent,
        body: { action, targetId: b.studentId },
      });
      expect(g.status).toBe(404);
    }
    // Even with a genuine grant for A's own child, B's data cannot be exported or deleted.
    const own = await call(env, 'POST', '/v1/adult-grants', {
      token: a.parent,
      body: { action: 'export', targetId: a.studentId },
    });
    const exp = await call(env, 'POST', '/v1/exports', {
      token: a.parent,
      body: { studentId: b.studentId },
      headers: { 'x-adult-grant': own.body.data.grant },
    });
    expect(exp.status).toBe(404);
    const del = await call(env, 'POST', '/v1/deletion-requests', {
      token: a.parent,
      body: { scope: 'student', studentId: b.studentId },
      headers: { 'x-adult-grant': own.body.data.grant },
    });
    expect(del.status).toBe(404);
    const acct = await call(env, 'POST', '/v1/deletion-requests', {
      token: a.parent,
      body: { scope: 'account', accountId: b.parentId },
      headers: { 'x-adult-grant': own.body.data.grant },
    });
    expect(acct.status).toBe(404);

    const list = await call(env, 'GET', '/v1/students', { token: a.parent });
    expect(list.body.data.students.map((s: { id: string }) => s.id)).toEqual([a.studentId]);
    // B is unchanged.
    const bHome = await call(env, 'GET', `/v1/students/${b.studentId}/home`, { token: b.parent });
    expect(bHome.body.data.student.nickname).toBe('Kid');
  });

  it('child A cannot use family B practice routes', async () => {
    for (const url of [
      `/v1/students/${b.studentId}/home`,
      `/v1/students/${b.studentId}/mistakes`,
      `/v1/sessions/${bSessionId}`,
      `/v1/sessions/${bSessionId}/items/${bItemId}`,
    ]) {
      expect((await call(env, 'GET', url, { token: a.child })).status, url).toBe(404);
    }
    const start = await call(env, 'POST', `/v1/students/${b.studentId}/sessions`, {
      token: a.child,
      body: { mode: 'daily' },
      headers: { 'idempotency-key': 'isolation-1234' },
    });
    expect(start.status).toBe(404);
    const answer = await call(env, 'POST', `/v1/sessions/${bSessionId}/items/${bItemId}/answer`, {
      token: a.child,
      body: { optionId: 'a' },
    });
    expect(answer.status).toBe(404);
  });
});

describe('child scope', () => {
  it('child token cannot call guardian, staff or billing APIs', async () => {
    const forbidden: Array<
      [method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown]
    > = [
      ['GET', '/v1/students'],
      ['POST', '/v1/students', { nickname: 'x', avatarKey: 'x', grade: 4, timezone: 'UTC' }],
      ['PATCH', `/v1/students/${a.studentId}`, { grade: 6 }],
      ['GET', `/v1/students/${a.studentId}/devices`],
      ['POST', `/v1/students/${a.studentId}/child-sessions`, { deviceLabel: 'x' }],
      ['DELETE', `/v1/child-sessions/${a.childSessionId}`],
      ['GET', '/v1/consents'],
      ['POST', '/v1/adult-grants', { action: 'export', targetId: a.studentId }],
      ['POST', '/v1/exports', { studentId: a.studentId }],
      ['POST', '/v1/deletion-requests', { scope: 'student', studentId: a.studentId }],
      ['GET', '/v1/billing/entitlements'],
      [
        'POST',
        '/v1/billing/purchase-intents',
        { studentId: a.studentId, productId: 'imc_pro_monthly' },
      ],
      ['POST', '/v1/billing/restore', {}],
      ['GET', '/v1/admin/questions'],
      ['GET', '/v1/admin/me'],
      ['GET', '/v1/admin/reports'],
    ];
    for (const [method, url, body] of forbidden) {
      const r = await call(env, method, url, { token: a.child, body });
      expect(r.status, `${method} ${url}`).toBe(403);
      expect(r.raw).not.toContain('billingCustomerId');
    }
    const me = await call(env, 'GET', '/v1/me', { token: a.child });
    expect(me.status).toBe(200);
    expect(me.body.data.kind).toBe('child');
    expect(me.raw).not.toMatch(/billing|entitlement|consent|email/i);
  });

  it('adult tokens cannot use child-only practice routes and are not staff', async () => {
    const start = await call(env, 'POST', `/v1/students/${a.studentId}/sessions`, {
      token: a.parent,
      body: { mode: 'daily' },
      headers: { 'idempotency-key': 'adult-start-1' },
    });
    expect(start.status).toBe(403);
    const admin = await call(env, 'GET', '/v1/admin/questions', { token: a.parent });
    expect(admin.status).toBe(403);
  });

  it('staff content roles do not grant access to student records', async () => {
    const editor = await staffToken(env, 'editor');
    const r = await call(env, 'GET', `/v1/students/${b.studentId}/home`, { token: editor });
    expect(r.status).toBe(404);
  });

  it('rejects unsigned, wrongly signed, expired and wrong-audience JWTs', async () => {
    const good = await adultToken(env);
    const [h, p] = good.split('.');
    const unsigned = `${h}.${p}.`;
    const tampered = `${h}.${Buffer.from(JSON.stringify({ sub: a.parentId, iss: env.config.AUTH_ISSUER, aud: env.config.AUTH_AUDIENCE, exp: 9999999999 })).toString('base64url')}.${good.split('.')[2]}`;
    for (const token of [unsigned, tampered, 'not-a-token', `${h}.${p}.invalidsig`]) {
      const r = await call(env, 'GET', '/v1/students', { token });
      expect(r.status).toBe(401);
    }
    const { mintAdultJwt } = await import('@imc/testing');
    const expired = await mintAdultJwt({
      secret: env.config.AUTH_JWT_SECRET,
      issuer: env.config.AUTH_ISSUER,
      audience: env.config.AUTH_AUDIENCE,
      sub: a.parentId,
      expiresInSeconds: -60,
    });
    expect((await call(env, 'GET', '/v1/students', { token: expired })).status).toBe(401);
    const wrongAud = await mintAdultJwt({
      secret: env.config.AUTH_JWT_SECRET,
      issuer: env.config.AUTH_ISSUER,
      audience: 'someone-else',
      sub: a.parentId,
    });
    expect((await call(env, 'GET', '/v1/students', { token: wrongAud })).status).toBe(401);
    expect((await call(env, 'GET', '/v1/students')).status).toBe(401);
  });
});

describe('isolation enforced by the runtime database role', () => {
  async function asRuntime<T>(
    ctx: { type: string; account?: string; student?: string },
    fn: (c: pg.Client) => Promise<T>,
  ): Promise<T> {
    const c = new pg.Client({ connectionString: urls.runtimeUrl });
    await c.connect();
    try {
      await c.query('begin');
      await c.query(
        `select set_config('app.principal_type', $1, true), set_config('app.account_id', $2, true),
                set_config('app.student_id', $3, true)`,
        [ctx.type, ctx.account ?? '', ctx.student ?? ''],
      );
      return await fn(c);
    } finally {
      await c.query('rollback').catch(() => undefined);
      await c.end();
    }
  }

  it('runtime role is not superuser, owner or BYPASSRLS', async () => {
    const c = new pg.Client({ connectionString: urls.runtimeUrl });
    await c.connect();
    const { rows } = await c.query(
      `select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    const owners = await c.query(
      `select count(*)::int as n from pg_tables where schemaname = 'app' and tableowner = current_user`,
    );
    await c.end();
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    expect(owners.rows[0].n).toBe(0);
  });

  it('missing context denies access to student data', async () => {
    const rows = await asRuntime({ type: '' }, async (c) => ({
      students: (await c.query('select id from app.students')).rowCount,
      attempts: (await c.query('select id from app.attempts')).rowCount,
      sessions: (await c.query('select id from app.practice_sessions')).rowCount,
      topics: (await c.query('select id from app.topics')).rowCount,
    }));
    expect(rows).toEqual({ students: 0, attempts: 0, sessions: 0, topics: 0 });
  });

  it('adult context sees only linked children; child context only itself', async () => {
    const adult = await asRuntime({ type: 'adult', account: a.parentId }, async (c) => ({
      students: (await c.query('select id from app.students')).rows.map((r) => r.id),
      bAttempts: (await c.query('select id from app.attempts where student_id = $1', [b.studentId]))
        .rowCount,
      bSessions: (
        await c.query('select id from app.practice_sessions where student_id = $1', [b.studentId])
      ).rowCount,
      bReviews: (
        await c.query('select 1 from app.review_items where student_id = $1', [b.studentId])
      ).rowCount,
    }));
    expect(adult).toEqual({ students: [a.studentId], bAttempts: 0, bSessions: 0, bReviews: 0 });

    const child = await asRuntime({ type: 'child', student: a.studentId }, async (c) => ({
      students: (await c.query('select id from app.students')).rows.map((r) => r.id),
      bAttempts: (await c.query('select id from app.attempts where student_id = $1', [b.studentId]))
        .rowCount,
      guardianLinks: (await c.query('select 1 from app.guardian_links')).rowCount,
      entitlementsOfB: (
        await c.query('select 1 from app.entitlements where student_id = $1', [b.studentId])
      ).rowCount,
    }));
    expect(child).toEqual({
      students: [a.studentId],
      bAttempts: 0,
      guardianLinks: 0,
      entitlementsOfB: 0,
    });
  });

  it('context cannot be spoofed into a write on another family', async () => {
    await asRuntime({ type: 'adult', account: a.parentId }, async (c) => {
      const upd = await c.query(`update app.students set nickname = 'x' where id = $1`, [
        b.studentId,
      ]);
      expect(upd.rowCount).toBe(0);
    });
    await expect(
      asRuntime({ type: 'adult', account: a.parentId }, (c) =>
        c.query(`insert into app.guardian_links (account_id, student_id) values ($1, $2)`, [
          a.parentId,
          b.studentId,
        ]),
      ),
    ).rejects.toThrow(/duplicate key|row-level security/);
    await expect(
      asRuntime({ type: 'child', student: a.studentId }, (c) =>
        c.query(
          `insert into app.practice_sessions (student_id, mode, local_date, timezone_snapshot, selection_seed, item_count)
           values ($1, 'daily', '2030-01-01', 'UTC', 'x', 1)`,
          [b.studentId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('answer keys are not directly readable and grading refuses foreign items', async () => {
    await expect(
      asRuntime({ type: 'system' }, (c) => c.query('select * from private.answer_keys')),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRuntime({ type: 'child', student: a.studentId }, (c) =>
        c.query('select app.staff_answer_key(gen_random_uuid())'),
      ),
    ).rejects.toThrow(/not readable/);
    // A child cannot grade or reveal another child's item.
    await expect(
      asRuntime({ type: 'child', student: a.studentId }, (c) =>
        c.query('select * from app.grade_item($1, $2)', [bItemId, 'a']),
      ),
    ).rejects.toThrow(/not gradable/);
    const revealed = await asRuntime({ type: 'child', student: a.studentId }, (c) =>
      c.query('select app.revealed_answer_key($1) as k', [bItemId]),
    );
    expect(revealed.rows[0].k).toBeNull();
    const byGuardianA = await asRuntime({ type: 'adult', account: a.parentId }, (c) =>
      c.query('select app.revealed_answer_key($1) as k', [bItemId]),
    );
    expect(byGuardianA.rows[0].k).toBeNull();
  });

  it('attempts and audit events are immutable', async () => {
    await expect(
      asRuntime({ type: 'system' }, (c) => c.query(`update app.attempts set is_correct = true`)),
    ).rejects.toThrow(/permission denied|not permitted/);
    await expect(
      asRuntime({ type: 'system' }, (c) => c.query(`delete from app.audit_events`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asOwner(urls.migrationUrl, (c) => c.query(`update app.audit_events set reason = 'x'`)),
    ).rejects.toThrow(/not permitted/);
  });
});
