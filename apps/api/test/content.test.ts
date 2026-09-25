import { asOwner } from '@imc/testing';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jobs } from '@imc/domain';
import {
  call,
  createFamily,
  createTestEnv,
  resetData,
  seedQuestions,
  startSession,
  staffToken,
  urls,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
let editor: string;
let reviewer: string;
let admin: string;

beforeAll(async () => {
  await resetData();
  env = await createTestEnv();
  await seedQuestions(env, 3);
  editor = await staffToken(env, 'editor');
  reviewer = await staffToken(env, 'reviewer');
  admin = await staffToken(env, 'administrator');
});
afterAll(async () => env.close());

const baseVersion = (overrides: Record<string, unknown> = {}) => ({
  grade: 4,
  topicSlug: 'arithmetic',
  difficulty: 1,
  locale: 'en',
  stemBlocks: [{ type: 'text', text: `What is 6 x 7? (${Math.random()})` }],
  options: [
    { id: 'a', text: '36' },
    { id: 'b', text: '42' },
    { id: 'c', text: '48' },
    { id: 'd', text: '49' },
  ],
  correctOptionId: 'b',
  explanationBlocks: [{ type: 'text', text: 'Six groups of seven total 42.' }],
  ...overrides,
});

async function createDraft(overrides: Record<string, unknown> = {}, rightsStatus = 'cleared') {
  const r = await call(env, 'POST', '/v1/admin/questions', {
    token: editor,
    body: { sourceType: 'original', rightsStatus, version: baseVersion(overrides) },
  });
  expect(r.status, r.raw).toBe(201);
  return r.body.data as { questionId: string; versionId: string };
}

const post = (token: string, url: string, body?: unknown) =>
  call(env, 'POST', url, { token, body });

describe('editorial workflow', () => {
  it('draft -> in_review -> approved -> published with an independent reviewer', async () => {
    const { versionId } = await createDraft();
    expect(
      (await post(editor, `/v1/admin/versions/${versionId}/submit-review`)).body.data.state,
    ).toBe('in_review');
    const approve = await post(reviewer, `/v1/admin/versions/${versionId}/review`, {
      decision: 'approve',
    });
    expect(approve.body.data.state).toBe('approved');
    const pub = await post(admin, `/v1/admin/versions/${versionId}/publish`);
    expect(pub.body.data.state).toBe('published');
    const view = await call(env, 'GET', `/v1/admin/versions/${versionId}`, { token: editor });
    expect(view.body.data.correctOptionId).toBe('b');
    expect(view.body.data.reviews[0].decision).toBe('approve');
    const audit = await call(
      env,
      'GET',
      `/v1/admin/audit?targetType=question_version&targetId=${versionId}`,
      { token: admin },
    );
    expect(audit.body.data.items.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining([
        'question.created',
        'version.submitted',
        'version.review.approve',
        'version.published',
      ]),
    );
  });

  it('an author cannot approve their own version', async () => {
    const { versionId } = await createDraft();
    await post(editor, `/v1/admin/versions/${versionId}/submit-review`);
    // The editor lacks the reviewer role entirely...
    expect(
      (await post(editor, `/v1/admin/versions/${versionId}/review`, { decision: 'approve' }))
        .status,
    ).toBe(403);
    // ...and an administrator who authored a version still cannot approve it.
    const own = await call(env, 'POST', '/v1/admin/questions', {
      token: admin,
      body: { sourceType: 'original', rightsStatus: 'cleared', version: baseVersion() },
    });
    const vid = own.body.data.versionId;
    await post(admin, `/v1/admin/versions/${vid}/submit-review`);
    const self = await post(admin, `/v1/admin/versions/${vid}/review`, { decision: 'approve' });
    expect(self.status).toBe(403);
    expect(self.body.error!.message).toMatch(/own version/);
    // The database refuses it too.
    await expect(
      asOwner(urls.migrationUrl, (c) =>
        c.query(`update app.question_versions set approved_by = author_id where id = $1`, [vid]),
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('post-approval edits return the version to draft and invalidate the approval hash', async () => {
    const { versionId } = await createDraft();
    await post(editor, `/v1/admin/versions/${versionId}/submit-review`);
    await post(reviewer, `/v1/admin/versions/${versionId}/review`, { decision: 'approve' });
    const edit = await call(env, 'PATCH', `/v1/admin/versions/${versionId}`, {
      token: editor,
      body: baseVersion({ correctOptionId: 'c' }),
    });
    expect(edit.body.data.state).toBe('draft');
    const publish = await post(admin, `/v1/admin/versions/${versionId}/publish`);
    expect(publish.status).toBe(409);
    // A direct state flip without re-review cannot publish either: the hash no longer matches.
    await asOwner(urls.migrationUrl, (c) =>
      c.query(
        `update app.question_versions set state = 'approved', approved_by = $2,
           approved_content_hash = (select reviewed_content_hash from app.content_reviews where version_id = $1 limit 1)
         where id = $1`,
        [versionId, '00000000-0000-4000-8000-00000000e002'],
      ),
    );
    const sneaky = await post(admin, `/v1/admin/versions/${versionId}/publish`);
    expect(sneaky.status).toBe(409);
    expect(sneaky.body.error!.message).toMatch(/changed after approval/);
  });

  it('request_changes returns to draft and requires comments', async () => {
    const { versionId } = await createDraft();
    await post(editor, `/v1/admin/versions/${versionId}/submit-review`);
    expect(
      (
        await post(reviewer, `/v1/admin/versions/${versionId}/review`, {
          decision: 'request_changes',
        })
      ).status,
    ).toBe(400);
    const r = await post(reviewer, `/v1/admin/versions/${versionId}/review`, {
      decision: 'request_changes',
      comments: 'Clarify units.',
    });
    expect(r.body.data.state).toBe('draft');
  });

  it('publication requires cleared rights, four distinct choices and a valid key', async () => {
    const restricted = await createDraft({}, 'unknown');
    await post(editor, `/v1/admin/versions/${restricted.versionId}/submit-review`);
    await post(reviewer, `/v1/admin/versions/${restricted.versionId}/review`, {
      decision: 'approve',
    });
    const blocked = await post(admin, `/v1/admin/versions/${restricted.versionId}/publish`);
    expect(blocked.status).toBe(400);
    expect(JSON.stringify(blocked.body.error!.details)).toContain('RIGHTS_NOT_CLEARED');

    const three = await createDraft({ options: baseVersion().options.slice(0, 3) });
    const submit = await post(editor, `/v1/admin/versions/${three.versionId}/submit-review`);
    expect(submit.status).toBe(400);
    expect(JSON.stringify(submit.body.error!.details)).toContain('OPTION_COUNT');

    const badKey = await call(env, 'POST', '/v1/admin/questions', {
      token: editor,
      body: {
        sourceType: 'original',
        rightsStatus: 'cleared',
        version: baseVersion({ correctOptionId: 'z' }),
      },
    });
    expect(badKey.status).toBe(400);

    const html = await call(env, 'POST', '/v1/admin/questions', {
      token: editor,
      body: {
        sourceType: 'original',
        rightsStatus: 'cleared',
        version: baseVersion({
          stemBlocks: [{ type: 'html', html: '<img src=x onerror=alert(1)>' }],
        }),
      },
    });
    expect(html.status).toBe(400);
  });

  it('drafts are never served to students', async () => {
    const { versionId } = await createDraft();
    const f = await createFamily(env);
    const s = await startSession(env, f);
    const used = await asOwner(
      urls.migrationUrl,
      async (c) =>
        (
          await c.query(`select 1 from app.session_items where question_version_id = $1`, [
            versionId,
          ])
        ).rowCount,
    );
    expect(used).toBe(0);
    expect(s.status).toBe(201);
  });

  it('staff roles are enforced per action', async () => {
    const { versionId } = await createDraft();
    expect((await post(reviewer, `/v1/admin/versions/${versionId}/submit-review`)).status).toBe(
      403,
    );
    await post(editor, `/v1/admin/versions/${versionId}/submit-review`);
    await post(reviewer, `/v1/admin/versions/${versionId}/review`, { decision: 'approve' });
    expect((await post(editor, `/v1/admin/versions/${versionId}/publish`)).status).toBe(403);
    expect((await post(reviewer, `/v1/admin/versions/${versionId}/publish`)).status).toBe(403);
    expect(
      (await call(env, 'GET', '/v1/admin/metrics?from=2026-01-01&to=2026-12-31', { token: editor }))
        .status,
    ).toBe(403);
  });

  it('inactive staff roles are rejected on every request', async () => {
    expect((await call(env, 'GET', '/v1/admin/me', { token: reviewer })).status).toBe(200);
    await asOwner(urls.migrationUrl, (c) =>
      c.query(
        `update app.staff_roles set active = false where account_id = '00000000-0000-4000-8000-00000000e002'`,
      ),
    );
    try {
      expect((await call(env, 'GET', '/v1/admin/me', { token: reviewer })).status).toBe(403);
    } finally {
      await asOwner(urls.migrationUrl, (c) =>
        c.query(
          `update app.staff_roles set active = true where account_id = '00000000-0000-4000-8000-00000000e002'`,
        ),
      );
    }
  });
});

describe('versioning', () => {
  it('a new publication does not alter an existing session or historical explanation', async () => {
    const f = await createFamily(env, { grade: 6 });
    const s = await startSession(env, f);
    const sessionId = s.body.data.sessionId;
    const itemId = s.body.data.nextItemId;
    const before = await call(env, 'GET', `/v1/sessions/${sessionId}/items/${itemId}`, {
      token: f.child,
    });
    const { versionId: oldVersion, questionId } = await asOwner(urls.migrationUrl, async (c) => {
      const { rows } = await c.query(
        `select v.id as "versionId", v.question_id as "questionId" from app.session_items i
           join app.question_versions v on v.id = i.question_version_id where i.id = $1`,
        [itemId],
      );
      return rows[0];
    });
    const oldKey = await asOwner(
      urls.migrationUrl,
      async (c) =>
        (
          await c.query(`select correct_option_id from private.answer_keys where version_id = $1`, [
            oldVersion,
          ])
        ).rows[0].correct_option_id,
    );
    // Correction: new draft from the published version, edit, review, publish.
    const draft = await post(editor, `/v1/admin/questions/${questionId}/versions`);
    expect(draft.status).toBe(201);
    const newVersion = draft.body.data.versionId;
    const view = await call(env, 'GET', `/v1/admin/versions/${newVersion}`, { token: editor });
    const loc = view.body.data.localizations[0];
    await call(env, 'PATCH', `/v1/admin/versions/${newVersion}`, {
      token: editor,
      body: {
        grade: 6,
        topicSlug: view.body.data.version.topicSlug,
        difficulty: view.body.data.version.difficulty,
        locale: 'en',
        stemBlocks: [{ type: 'text', text: 'CORRECTED STEM' }],
        options: loc.options,
        correctOptionId: view.body.data.correctOptionId,
        explanationBlocks: [{ type: 'text', text: 'CORRECTED EXPLANATION' }],
      },
    });
    await post(editor, `/v1/admin/versions/${newVersion}/submit-review`);
    await post(reviewer, `/v1/admin/versions/${newVersion}/review`, { decision: 'approve' });
    expect((await post(admin, `/v1/admin/versions/${newVersion}/publish`)).body.data.state).toBe(
      'published',
    );

    const after = await call(env, 'GET', `/v1/sessions/${sessionId}/items/${itemId}`, {
      token: f.child,
    });
    expect(after.body.data).toEqual(
      before.body.data.assets
        ? { ...before.body.data, assets: after.body.data.assets }
        : before.body.data,
    );
    const ans = await call(env, 'POST', `/v1/sessions/${sessionId}/items/${itemId}/answer`, {
      token: f.child,
      body: { optionId: oldKey },
    });
    expect(ans.body.data.correct).toBe(true);
    expect(JSON.stringify(ans.body.data.explanationBlocks)).not.toContain('CORRECTED');
    // Old version is retired and immutable; editing it is refused.
    const oldView = await call(env, 'GET', `/v1/admin/versions/${oldVersion}`, { token: editor });
    expect(oldView.body.data.version.state).toBe('retired');
    const edit = await call(env, 'PATCH', `/v1/admin/versions/${oldVersion}`, {
      token: editor,
      body: baseVersion({ grade: 6 }),
    });
    expect(edit.status).toBe(409);
    await expect(
      asOwner(urls.migrationUrl, (c) =>
        c.query(`update app.question_localizations set stem_blocks = '[]' where version_id = $1`, [
          oldVersion,
        ]),
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('retiring with flagAffectedResults halts affected sessions and audits without rewriting attempts', async () => {
    const f = await createFamily(env, { grade: 5 });
    const s = await startSession(env, f);
    const itemId = s.body.data.nextItemId;
    const versionId = await asOwner(
      urls.migrationUrl,
      async (c) =>
        (await c.query(`select question_version_id from app.session_items where id = $1`, [itemId]))
          .rows[0].question_version_id,
    );
    const r = await post(admin, `/v1/admin/versions/${versionId}/retire`, {
      reason: 'Answer key is materially wrong',
      flagAffectedResults: true,
    });
    expect(r.body.data.state).toBe('retired');
    await jobs.runJobsOnce(env.deps);
    const state = await call(env, 'GET', `/v1/sessions/${s.body.data.sessionId}`, {
      token: f.child,
    });
    expect(state.body.data.status).toBe('abandoned');
    const alerts = await asOwner(
      urls.migrationUrl,
      async (c) =>
        (
          await c.query(`select details from app.ops_alerts where dedupe_key = $1`, [
            `wrong-key:${versionId}`,
          ])
        ).rows,
    );
    expect(alerts[0].details.haltedSessions).toBe(1);
  });
});

describe('imports and assets', () => {
  it('imports into drafts with per-item errors and duplicate detection', async () => {
    const good = {
      schemaVersion: 1,
      sourceReference: 'import-test-1',
      stemBlocks: [{ type: 'text', text: 'What is 9 + 10?' }],
      options: [
        { id: 'a', text: '19' },
        { id: 'b', text: '21' },
        { id: 'c', text: '910' },
        { id: 'd', text: '1' },
      ],
      correctOptionId: 'a',
      explanationBlocks: [{ type: 'text', text: '9 + 10 = 19.' }],
      grade: 4,
      topicSlug: 'arithmetic',
      difficulty: 1,
    };
    const body = {
      schemaVersion: 1,
      sourceType: 'original',
      rightsStatus: 'cleared',
      questions: [
        good,
        { ...good, sourceReference: 'import-test-2', correctOptionId: 'e' },
        { ...good, sourceReference: 'import-test-3', topicSlug: 'no-such-topic' },
        { ...good, sourceReference: 'import-test-1' },
        { bogus: true },
      ],
    };
    const r = await post(editor, '/v1/admin/imports', body);
    expect(r.status).toBe(202);
    await jobs.runJobsOnce(env.deps);
    const status = await call(env, 'GET', `/v1/admin/imports/${r.body.data.importId}`, {
      token: editor,
    });
    expect(status.body.data).toMatchObject({
      status: 'completed',
      createdCount: 1,
      duplicateCount: 1,
      totalItems: 5,
    });
    expect(
      status.body.data.errors.map((e: { index: number; code: string }) => [e.index, e.code]),
    ).toEqual([
      [1, 'ANSWER_NOT_AN_OPTION'],
      [2, 'UNKNOWN_TOPIC'],
      [3, 'DUPLICATE'],
      [4, 'INVALID_ITEM'],
    ]);
    const drafts = await call(env, 'GET', '/v1/admin/questions?state=draft&limit=100', {
      token: editor,
    });
    expect(
      drafts.body.data.items.some(
        (v: { stemPreview: string }) => v.stemPreview === 'What is 9 + 10?',
      ),
    ).toBe(true);
  });

  it('uploads an image, verifies checksum and file signature, and refuses disguised files', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('fake-png-body-for-tests'),
    ]);
    const checksum = createHash('sha256').update(png).digest('hex');
    const intent = await post(editor, '/v1/admin/assets/upload-intent', {
      mime: 'image/png',
      byteSize: png.length,
      checksum,
      altText: 'A triangle with sides 3, 4 and 5',
    });
    expect(intent.status).toBe(201);
    const early = await post(editor, `/v1/admin/assets/${intent.body.data.assetId}/complete`);
    expect(early.status).toBe(409);
    const url = new URL(intent.body.data.uploadUrl);
    const put = await env.app.inject({
      method: 'PUT',
      url: url.pathname + url.search,
      headers: { 'content-type': 'image/png' },
      payload: png,
    });
    expect(put.statusCode).toBe(200);
    const done = await post(editor, `/v1/admin/assets/${intent.body.data.assetId}/complete`);
    expect(done.body.data).toMatchObject({ status: 'ready', mime: 'image/png' });

    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const svgIntent = await post(editor, '/v1/admin/assets/upload-intent', {
      mime: 'image/png',
      byteSize: svg.length,
      checksum: createHash('sha256').update(svg).digest('hex'),
      altText: 'x',
    });
    const u2 = new URL(svgIntent.body.data.uploadUrl);
    await env.app.inject({
      method: 'PUT',
      url: u2.pathname + u2.search,
      headers: { 'content-type': 'image/png' },
      payload: svg,
    });
    const rejected = await post(editor, `/v1/admin/assets/${svgIntent.body.data.assetId}/complete`);
    expect(rejected.status).toBe(400);
    expect(
      (
        await post(editor, '/v1/admin/assets/upload-intent', {
          mime: 'image/svg+xml',
          byteSize: 10,
          checksum,
          altText: 'x',
        })
      ).status,
    ).toBe(400);

    // An image referenced by a solution is only signed after an answer.
    const { versionId } = await createDraft({
      grade: 5,
      explanationBlocks: [
        { type: 'text', text: 'See the diagram.' },
        { type: 'image', assetId: intent.body.data.assetId, alt: 'Solution diagram' },
      ],
    });
    const view = await call(env, 'GET', `/v1/admin/versions/${versionId}`, { token: editor });
    expect(Object.keys(view.body.data.assets)).toEqual([intent.body.data.assetId]);
    const signed = new URL(view.body.data.assets[intent.body.data.assetId].url);
    const fetched = await env.app.inject({ method: 'GET', url: signed.pathname + signed.search });
    expect(fetched.statusCode).toBe(200);
    const tampered = await env.app.inject({
      method: 'GET',
      url: signed.pathname + signed.search.replace(/sig=[0-9a-f]/, 'sig=0'),
    });
    expect(tampered.statusCode).toBe(403);
  });
});
