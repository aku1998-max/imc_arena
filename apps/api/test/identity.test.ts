import { asOwner } from '@imc/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adultToken,
  call,
  createFamily,
  createTestEnv,
  resetData,
  seedQuestions,
  startSession,
  urls,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;

beforeAll(async () => {
  await resetData();
  env = await createTestEnv();
  await seedQuestions(env, 3);
});
afterAll(async () => env.close());

describe('child sessions', () => {
  it('store only a hash of a 256-bit token bound to one student and device', async () => {
    const f = await createFamily(env);
    expect(Buffer.from(f.child, 'base64url').length).toBe(32);
    const rows = await asOwner(
      urls.migrationUrl,
      async (c) =>
        (
          await c.query(
            `select token_hash, student_id, device_label, expires_at from app.child_sessions where id = $1`,
            [f.childSessionId],
          )
        ).rows,
    );
    expect(rows[0].token_hash).not.toContain(f.child);
    expect(rows[0].student_id).toBe(f.studentId);
    const days = (new Date(rows[0].expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('a revoked child session fails immediately', async () => {
    const f = await createFamily(env);
    expect((await call(env, 'GET', '/v1/me', { token: f.child })).status).toBe(200);
    const devices = await call(env, 'GET', `/v1/students/${f.studentId}/devices`, {
      token: f.parent,
    });
    expect(devices.body.data.devices).toHaveLength(1);
    const revoke = await call(env, 'DELETE', `/v1/child-sessions/${f.childSessionId}`, {
      token: f.parent,
    });
    expect(revoke.status).toBe(204);
    const after = await call(env, 'GET', '/v1/me', { token: f.child });
    expect(after.status).toBe(401);
    expect((await startSession(env, f)).status).toBe(401);
  });

  it('an expired child session requires parent sign-in', async () => {
    const f = await createFamily(env);
    await asOwner(urls.migrationUrl, (c) =>
      c.query(
        `update app.child_sessions set expires_at = now() - interval '1 second' where id = $1`,
        [f.childSessionId],
      ),
    );
    expect((await call(env, 'GET', '/v1/me', { token: f.child })).status).toBe(401);
  });

  it('withdrawing core consent revokes child devices', async () => {
    const f = await createFamily(env);
    await call(env, 'POST', '/v1/consents', {
      token: f.parent,
      body: {
        studentId: f.studentId,
        purpose: 'core_service',
        policyVersion: 'test-1',
        granted: false,
      },
    });
    expect((await call(env, 'GET', '/v1/me', { token: f.child })).status).toBe(401);
    const again = await call(env, 'POST', `/v1/students/${f.studentId}/child-sessions`, {
      token: f.parent,
      body: { deviceLabel: 'x' },
    });
    expect(again.status).toBe(403);
  });

  it('child-session creation is rate limited', async () => {
    const f = await createFamily(env);
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (
        await call(env, 'POST', `/v1/students/${f.studentId}/child-sessions`, {
          token: f.parent,
          body: { deviceLabel: `d${i}` },
        })
      ).status;
    }
    expect(last).toBe(429);
  });
});

describe('adult action grants', () => {
  it('require a fresh OTP and are single-use and action/target scoped', async () => {
    const f = await createFamily(env);
    const stale = await adultToken(env, f.parentId, { otpAgeSeconds: 600 });
    const noAmr = await adultToken(env, f.parentId, { otpAgeSeconds: null });
    for (const token of [stale, noAmr]) {
      const r = await call(env, 'POST', '/v1/adult-grants', {
        token,
        body: { action: 'export', targetId: f.studentId },
      });
      expect(r.status).toBe(403);
      expect(r.body.error!.code).toBe('REAUTH_REQUIRED');
    }
    const g = await call(env, 'POST', '/v1/adult-grants', {
      token: f.parent,
      body: { action: 'delete_student', targetId: f.studentId },
    });
    expect(g.status).toBe(201);
    const grant = g.body.data.grant as string;
    // Wrong action: grant for deletion does not authorise an export.
    const wrongAction = await call(env, 'POST', '/v1/exports', {
      token: f.parent,
      body: { studentId: f.studentId },
      headers: { 'x-adult-grant': grant },
    });
    expect(wrongAction.status).toBe(403);
    expect(wrongAction.body.error!.code).toBe('REAUTH_REQUIRED');
    // Missing grant.
    const missing = await call(env, 'POST', '/v1/exports', {
      token: f.parent,
      body: { studentId: f.studentId },
    });
    expect(missing.body.error!.code).toBe('REAUTH_REQUIRED');
    // A grant cannot be used by another adult.
    const other = await createFamily(env);
    const stolen = await call(env, 'POST', '/v1/deletion-requests', {
      token: other.parent,
      body: { scope: 'student', studentId: f.studentId },
      headers: { 'x-adult-grant': grant },
    });
    expect(stolen.status).toBe(404);
    // Correct use succeeds once.
    const ok = await call(env, 'POST', '/v1/deletion-requests', {
      token: f.parent,
      body: { scope: 'student', studentId: f.studentId },
      headers: { 'x-adult-grant': grant },
    });
    expect(ok.status).toBe(202);
    const f2 = await createFamily(env);
    const g2 = await call(env, 'POST', '/v1/adult-grants', {
      token: f2.parent,
      body: { action: 'export', targetId: f2.studentId },
    });
    const use = () =>
      call(env, 'POST', '/v1/exports', {
        token: f2.parent,
        body: { studentId: f2.studentId },
        headers: { 'x-adult-grant': g2.body.data.grant },
      });
    expect((await use()).status).toBe(202);
    expect((await use()).body.error!.code).toBe('REAUTH_REQUIRED');
  });

  it('expired grants are refused', async () => {
    const f = await createFamily(env);
    const g = await call(env, 'POST', '/v1/adult-grants', {
      token: f.parent,
      body: { action: 'export', targetId: f.studentId },
    });
    await asOwner(urls.migrationUrl, (c) =>
      c.query(`update app.adult_action_grants set expires_at = now() - interval '1 second'`),
    );
    const r = await call(env, 'POST', '/v1/exports', {
      token: f.parent,
      body: { studentId: f.studentId },
      headers: { 'x-adult-grant': g.body.data.grant },
    });
    expect(r.body.error!.code).toBe('REAUTH_REQUIRED');
  });
});

describe('staff MFA', () => {
  it('requires aal2 tokens when STAFF_REQUIRE_MFA is on', async () => {
    const strict = await createTestEnv({ STAFF_REQUIRE_MFA: 'true' });
    try {
      const aal1 = await adultToken(strict, '00000000-0000-4000-8000-00000000e003', {
        aal: 'aal1',
      });
      const aal2 = await adultToken(strict, '00000000-0000-4000-8000-00000000e003', {
        aal: 'aal2',
      });
      expect((await call(strict, 'GET', '/v1/admin/me', { token: aal1 })).status).toBe(403);
      expect((await call(strict, 'GET', '/v1/admin/me', { token: aal2 })).status).toBe(200);
    } finally {
      await strict.close();
    }
  });
});

describe('errors never leak internals', () => {
  it('validation errors echo paths, not values; unknown routes are 404 envelopes', async () => {
    const f = await createFamily(env);
    const r = await call(env, 'POST', '/v1/students', {
      token: f.parent,
      body: { nickname: 'x', avatarKey: 'owl', grade: 9, timezone: 'Not/AZone', secret: 'leak-me' },
    });
    expect(r.status).toBe(400);
    expect(r.raw).not.toContain('leak-me');
    expect(r.raw).not.toContain('Not/AZone');
    expect(r.body.requestId).toBeTruthy();
    const missing = await call(env, 'GET', '/v1/nope', { token: f.parent });
    expect(missing.status).toBe(404);
    expect(missing.body.error!.code).toBe('NOT_FOUND');
    const badUuid = await call(env, 'GET', '/v1/sessions/not-a-uuid', { token: f.parent });
    expect(badUuid.status).toBe(400);
    expect(badUuid.raw).not.toMatch(/select|syntax|stack/i);
  });
});
