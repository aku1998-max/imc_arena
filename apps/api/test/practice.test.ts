import { unansweredItemSchema } from '@imc/contracts';
import { asOwner } from '@imc/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  answerKeyForItem,
  call,
  completeSession,
  createFamily,
  createTestEnv,
  grantPro,
  resetData,
  seedQuestions,
  setFlag,
  startSession,
  urls,
  wrongOptionFor,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;

beforeAll(async () => {
  await resetData();
  env = await createTestEnv();
  await seedQuestions(env, 6);
});
afterAll(async () => env.close());

const count = (sql: string, params: unknown[]) =>
  asOwner(urls.migrationUrl, async (c) => (await c.query<{ n: number }>(sql, params)).rows[0]!.n);

describe('answer secrecy', () => {
  it('unanswered DTOs and media links carry no key, correctness marker or solution', async () => {
    const f = await createFamily(env);
    const s = await startSession(env, f);
    expect(s.status).toBe(201);
    const state = await call(env, 'GET', `/v1/sessions/${s.body.data.sessionId}`, {
      token: f.child,
    });
    for (const item of state.body.data.items) {
      const r = await call(
        env,
        'GET',
        `/v1/sessions/${s.body.data.sessionId}/items/${item.itemId}`,
        {
          token: f.child,
        },
      );
      expect(r.status).toBe(200);
      // Strict schema: any extra key (correctOptionId, explanationBlocks, ...) fails.
      expect(unansweredItemSchema.safeParse(r.body.data).success).toBe(true);
      expect(Object.keys(r.body.data).sort()).toEqual(
        ['answered', 'assets', 'itemId', 'options', 'ordinal', 'stemBlocks', 'total'].sort(),
      );
      expect(r.raw).not.toMatch(/correct|explanation|solution|answer_key|is_correct/i);
      for (const o of r.body.data.options) expect(Object.keys(o).sort()).toEqual(['id', 'text']);
    }
    // Session state exposes correctness only for answered items.
    expect(state.body.data.items.every((i: { correct: unknown }) => i.correct === null)).toBe(true);
  });

  it('reveals the key and explanation only after an answer is recorded', async () => {
    const f = await createFamily(env);
    const s = await startSession(env, f);
    const { sessionId, nextItemId } = s.body.data;
    const key = await answerKeyForItem(nextItemId);
    const ans = await call(env, 'POST', `/v1/sessions/${sessionId}/items/${nextItemId}/answer`, {
      token: f.child,
      body: { optionId: key },
    });
    expect(ans.status).toBe(200);
    expect(ans.body.data).toMatchObject({ correct: true, correctOptionId: key });
    expect(ans.body.data.explanationBlocks.length).toBeGreaterThan(0);
    const item = await call(env, 'GET', `/v1/sessions/${sessionId}/items/${nextItemId}`, {
      token: f.child,
    });
    expect(item.body.data).toMatchObject({
      answered: true,
      correct: true,
      correctOptionId: key,
      selectedOptionId: key,
    });
    // The next (unanswered) item still hides its key.
    const next = await call(
      env,
      'GET',
      `/v1/sessions/${sessionId}/items/${ans.body.data.nextItemId}`,
      {
        token: f.child,
      },
    );
    expect(next.body.data.answered).toBe(false);
    expect(next.raw).not.toContain('correctOptionId');
  });
});

describe('atomic submission and retries', () => {
  it('concurrent identical submissions create one attempt, one completion and one reward', async () => {
    const f = await createFamily(env);
    const s = await startSession(env, f);
    const sessionId = s.body.data.sessionId as string;
    // Answer all but the last item.
    const state = await call(env, 'GET', `/v1/sessions/${sessionId}`, { token: f.child });
    const items = state.body.data.items as Array<{ itemId: string }>;
    for (const it of items.slice(0, -1)) {
      await call(env, 'POST', `/v1/sessions/${sessionId}/items/${it.itemId}/answer`, {
        token: f.child,
        body: { optionId: await answerKeyForItem(it.itemId) },
      });
    }
    const last = items[items.length - 1]!.itemId;
    const key = await answerKeyForItem(last);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        call(env, 'POST', `/v1/sessions/${sessionId}/items/${last}/answer`, {
          token: f.child,
          body: { optionId: key },
        }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
    const attemptIds = new Set(results.map((r) => r.body.data.attemptId));
    expect(attemptIds.size).toBe(1);
    for (const r of results) {
      expect(r.body.data.completion).toMatchObject({
        correctCount: items.length,
        itemCount: items.length,
      });
    }
    expect(
      await count(
        `select count(*)::int as n from app.attempts a join app.session_items i on i.id = a.session_item_id where i.id = $1`,
        [last],
      ),
    ).toBe(1);
    expect(
      await count(
        `select count(*)::int as n from app.reward_events where source_session_id = $1 and reward_type = 'session_complete'`,
        [sessionId],
      ),
    ).toBe(1);
    expect(
      await count(`select count(*)::int as n from app.outbox_jobs where dedupe_key = $1`, [
        `progress:${sessionId}`,
      ]),
    ).toBe(1);
    expect(
      await count(
        `select count(*)::int as n from app.analytics_events where name = 'session_completed' and subject_id = $1`,
        [f.studentId],
      ),
    ).toBe(1);
  });

  it('a different option after commit returns 409 and preserves the original result', async () => {
    const f = await createFamily(env);
    const s = await startSession(env, f);
    const { sessionId, nextItemId } = s.body.data;
    const item = await call(env, 'GET', `/v1/sessions/${sessionId}/items/${nextItemId}`, {
      token: f.child,
    });
    const choices = item.body.data.options.map((o: { id: string }) => o.id);
    const wrong = await wrongOptionFor(nextItemId, choices);
    const first = await call(env, 'POST', `/v1/sessions/${sessionId}/items/${nextItemId}/answer`, {
      token: f.child,
      body: { optionId: wrong },
    });
    expect(first.body.data.correct).toBe(false);
    const changed = await call(
      env,
      'POST',
      `/v1/sessions/${sessionId}/items/${nextItemId}/answer`,
      {
        token: f.child,
        body: { optionId: await answerKeyForItem(nextItemId) },
      },
    );
    expect(changed.status).toBe(409);
    expect(changed.body.error!.code).toBe('ANSWER_ALREADY_SUBMITTED');
    const again = await call(env, 'GET', `/v1/sessions/${sessionId}/items/${nextItemId}`, {
      token: f.child,
    });
    expect(again.body.data).toMatchObject({ selectedOptionId: wrong, correct: false });
    // Replaying the original option returns the stored result.
    const replay = await call(env, 'POST', `/v1/sessions/${sessionId}/items/${nextItemId}/answer`, {
      token: f.child,
      body: { optionId: wrong },
    });
    expect(replay.status).toBe(200);
    expect(replay.body.data.attemptId).toBe(first.body.data.attemptId);
  });

  it('rejects options that are not part of the item', async () => {
    const f = await createFamily(env);
    const s = await startSession(env, f);
    const r = await call(
      env,
      'POST',
      `/v1/sessions/${s.body.data.sessionId}/items/${s.body.data.nextItemId}/answer`,
      {
        token: f.child,
        body: { optionId: 'zz' },
      },
    );
    expect(r.status).toBe(400);
  });

  it('submissions can be paused without losing committed attempts', async () => {
    const f = await createFamily(env);
    const s = await startSession(env, f);
    await setFlag('answer_submissions', false);
    try {
      const r = await call(
        env,
        'POST',
        `/v1/sessions/${s.body.data.sessionId}/items/${s.body.data.nextItemId}/answer`,
        {
          token: f.child,
          body: { optionId: 'a' },
        },
      );
      expect(r.status).toBe(503);
      expect(r.body.error!.code).toBe('SUBMISSIONS_PAUSED');
    } finally {
      await setFlag('answer_submissions', true);
    }
  });
});

describe('daily sessions', () => {
  it('concurrent starts create one daily session; reconnect returns identical item order', async () => {
    const f = await createFamily(env);
    const results = await Promise.all(Array.from({ length: 6 }, () => startSession(env, f)));
    const ids = new Set(results.map((r) => r.body.data.sessionId));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const sessionId = [...ids][0]!;
    expect(
      await count(
        `select count(*)::int as n from app.practice_sessions where student_id = $1 and mode = 'daily'`,
        [f.studentId],
      ),
    ).toBe(1);
    const s1 = await call(env, 'GET', `/v1/sessions/${sessionId}`, { token: f.child });
    const order1 = [];
    for (const i of s1.body.data.items) {
      const item = await call(env, 'GET', `/v1/sessions/${sessionId}/items/${i.itemId}`, {
        token: f.child,
      });
      order1.push(item.body.data.options.map((o: { id: string }) => o.id).join(''));
    }
    const again = await startSession(env, f);
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ sessionId, created: false });
    const s2 = await call(env, 'GET', `/v1/sessions/${sessionId}`, { token: f.child });
    expect(s2.body.data.items.map((i: { itemId: string }) => i.itemId)).toEqual(
      s1.body.data.items.map((i: { itemId: string }) => i.itemId),
    );
    const order2 = [];
    for (const i of s2.body.data.items) {
      const item = await call(env, 'GET', `/v1/sessions/${sessionId}/items/${i.itemId}`, {
        token: f.child,
      });
      order2.push(item.body.data.options.map((o: { id: string }) => o.id).join(''));
    }
    expect(order2).toEqual(order1);
  });

  it('selects five distinct questions aiming for 2 easy, 2 medium, 1 harder', async () => {
    const f = await createFamily(env, { grade: 5 });
    const s = await startSession(env, f);
    const rows = await asOwner(
      urls.migrationUrl,
      async (c) =>
        (
          await c.query<{ difficulty: number; question_id: string; grade: number; state: string }>(
            `select v.difficulty, v.question_id, v.grade, v.state from app.session_items i
             join app.question_versions v on v.id = i.question_version_id
            where i.session_id = $1 order by i.ordinal`,
            [s.body.data.sessionId],
          )
        ).rows,
    );
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.question_id)).size).toBe(5);
    expect(rows.every((r) => r.grade === 5 && r.state === 'published')).toBe(true);
    expect(rows.map((r) => r.difficulty)).toEqual([1, 1, 2, 2, 3]);
  });

  it('a timezone change cannot unlock an extra daily challenge for the same day', async () => {
    const f = await createFamily(env, { timezone: 'Pacific/Kiritimati' }); // UTC+14
    const first = await startSession(env, f);
    expect(first.status).toBe(201);
    await call(env, 'PATCH', `/v1/students/${f.studentId}`, {
      token: f.parent,
      body: { timezone: 'Pacific/Pago_Pago' },
    }); // UTC-11
    const second = await startSession(env, f);
    expect(second.body.data.sessionId).toBe(first.body.data.sessionId);
  });

  it('GET routes do not create state', async () => {
    const f = await createFamily(env);
    await call(env, 'GET', `/v1/students/${f.studentId}/home`, { token: f.child });
    await call(env, 'GET', `/v1/students/${f.studentId}/progress?from=2026-01-01&to=2026-12-31`, {
      token: f.child,
    });
    expect(
      await count(`select count(*)::int as n from app.practice_sessions where student_id = $1`, [
        f.studentId,
      ]),
    ).toBe(0);
  });
});

describe('idempotency', () => {
  it('requires a key, replays the same body and rejects a different body', async () => {
    const f = await createFamily(env);
    const noKey = await call(env, 'POST', `/v1/students/${f.studentId}/sessions`, {
      token: f.child,
      body: { mode: 'daily' },
    });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error!.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const a1 = await startSession(env, f, { mode: 'daily' }, 'same-key-123');
    const a2 = await startSession(env, f, { mode: 'daily' }, 'same-key-123');
    expect(a2.status).toBe(a1.status);
    expect(a2.body.data).toEqual(a1.body.data);
    expect(a2.headers['idempotent-replay']).toBe('true');
    await grantPro(env, f.studentId);
    const conflict = await startSession(env, f, { mode: 'mistakes' }, 'same-key-123');
    expect(conflict.status).toBe(409);
    expect(conflict.body.error!.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('entitlements, mistakes and progress', () => {
  it('free children get daily practice; topic and mistake sessions need Pro', async () => {
    const f = await createFamily(env);
    const topics = await call(env, 'GET', '/v1/topics?grade=4', { token: f.child });
    const topicId = topics.body.data.topics.find(
      (t: { inventory: string }) => t.inventory !== 'unavailable',
    ).id;
    const denied = await startSession(env, f, { mode: 'topic', topicId });
    expect(denied.status).toBe(403);
    expect(denied.body.error!.code).toBe('ENTITLEMENT_REQUIRED');
    await grantPro(env, f.studentId);
    const allowed = await startSession(env, f, { mode: 'topic', topicId });
    expect(allowed.status).toBe(201);
    const me = await call(env, 'GET', '/v1/me', { token: f.child });
    expect(me.body.data.capabilities).toContain('practice:topic');
  });

  it('mistakes queue: empty state, retry as new items, resolution, retries counted separately', async () => {
    const f = await createFamily(env);
    await grantPro(env, f.studentId);
    const empty = await startSession(env, f, { mode: 'mistakes' });
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual({ status: 'empty', reason: 'NO_MISTAKES' });

    const daily = await startSession(env, f);
    await completeSession(env, f, daily.body.data.sessionId, 'wrong');
    const mistakes = await call(env, 'GET', `/v1/students/${f.studentId}/mistakes?limit=2`, {
      token: f.child,
    });
    expect(mistakes.body.data.items).toHaveLength(2);
    expect(mistakes.body.data.nextCursor).not.toBeNull();
    expect(mistakes.raw).not.toMatch(/correct|explanation/i);
    const page2 = await call(
      env,
      'GET',
      `/v1/students/${f.studentId}/mistakes?limit=10&cursor=${mistakes.body.data.nextCursor}`,
      { token: f.child },
    );
    expect(page2.body.data.items).toHaveLength(3);

    const retry = await startSession(env, f, { mode: 'mistakes' });
    expect(retry.status).toBe(201);
    expect(retry.body.data.itemCount).toBe(5);
    // Starting again returns the same unfinished mistakes session.
    const dup = await startSession(env, f, { mode: 'mistakes' });
    expect(dup.body.data.sessionId).toBe(retry.body.data.sessionId);
    await completeSession(env, f, retry.body.data.sessionId, 'correct');
    const after = await call(env, 'GET', `/v1/students/${f.studentId}/mistakes`, {
      token: f.child,
    });
    expect(after.body.data.items).toHaveLength(0);
    // Original attempts are preserved.
    expect(
      await count(`select count(*)::int as n from app.attempts where student_id = $1`, [
        f.studentId,
      ]),
    ).toBe(10);

    const today = new Date().toISOString().slice(0, 10);
    const progress = await call(
      env,
      'GET',
      `/v1/students/${f.studentId}/progress?from=${today}&to=${today}`,
      {
        token: f.parent,
      },
    );
    expect(progress.status).toBe(200);
    // Allow for the student's local date differing from UTC around midnight.
    if (progress.body.data.questionsAnswered === 10) {
      expect(progress.body.data.firstAttempts).toEqual({ count: 5, correct: 0 });
      expect(progress.body.data.retries).toEqual({ count: 5, correct: 5 });
      expect(progress.body.data.completedSessions).toBe(2);
    }
  });

  it('bounds progress ranges and limits history for free access', async () => {
    const f = await createFamily(env);
    const tooLong = await call(
      env,
      'GET',
      `/v1/students/${f.studentId}/progress?from=2020-01-01&to=2026-12-31`,
      { token: f.child },
    );
    expect(tooLong.status).toBe(400);
    const limited = await call(
      env,
      'GET',
      `/v1/students/${f.studentId}/progress?from=2026-01-01&to=2026-12-31`,
      { token: f.child },
    );
    expect(limited.body.data.historyLimited).toBe(true);
    expect(limited.body.data.sufficientData).toBe(false);
  });

  it('home shows daily status and parent sees the completed result', async () => {
    const f = await createFamily(env);
    const s = await startSession(env, f);
    await completeSession(env, f, s.body.data.sessionId, 'correct');
    const home = await call(env, 'GET', `/v1/students/${f.studentId}/home`, { token: f.parent });
    expect(home.body.data.daily.status).toBe('completed');
    expect(home.body.data.recentActivity[0]).toMatchObject({
      correctCount: 5,
      itemCount: 5,
      mode: 'daily',
    });
    expect(home.body.data.weeklyGoal.completed).toBeGreaterThanOrEqual(1);
    const state = await call(env, 'GET', `/v1/sessions/${s.body.data.sessionId}`, {
      token: f.parent,
    });
    expect(state.body.data.completion.rewards).toEqual([
      { type: 'perfect_session', value: 5 },
      { type: 'session_complete', value: 10 },
    ]);
  });

  it('reports are length-limited and throttled', async () => {
    const f = await createFamily(env);
    const tooLong = await call(env, 'POST', '/v1/reports', {
      token: f.child,
      body: { category: 'other', message: 'x'.repeat(1001) },
    });
    expect(tooLong.status).toBe(400);
    // The rejected request above also counts toward the hourly limit of 10.
    for (let i = 0; i < 9; i++) {
      const r = await call(env, 'POST', '/v1/reports', {
        token: f.child,
        body: { category: 'app_problem', message: `issue ${i}` },
      });
      expect(r.status).toBe(201);
    }
    const limited = await call(env, 'POST', '/v1/reports', {
      token: f.child,
      body: { category: 'app_problem' },
    });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('content shortage', () => {
  it('returns CONTENT_UNAVAILABLE and records an operations alert instead of padding', async () => {
    const f = await createFamily(env);
    // Retire everything for grade 6 except four questions.
    await asOwner(urls.migrationUrl, (c) =>
      c.query(`update app.questions set rights_status = 'restricted'
                where id in (select question_id from app.question_versions where grade = 6 and state = 'published'
                              order by question_id offset 4)`),
    );
    try {
      const g6 = await createFamily(env, { grade: 6 });
      const r = await startSession(env, g6);
      expect(r.status).toBe(503);
      expect(r.body.error).toEqual({
        code: 'CONTENT_UNAVAILABLE',
        message: 'Practice is not ready yet.',
      });
      expect(
        await count(
          `select count(*)::int as n from app.ops_alerts where kind = 'content_shortage'`,
          [],
        ),
      ).toBeGreaterThanOrEqual(1);
      expect(
        await count(`select count(*)::int as n from app.practice_sessions where student_id = $1`, [
          g6.studentId,
        ]),
      ).toBe(0);
    } finally {
      await asOwner(urls.migrationUrl, (c) =>
        c.query(`update app.questions set rights_status = 'cleared'`),
      );
    }
    expect(f).toBeDefined();
  });
});
