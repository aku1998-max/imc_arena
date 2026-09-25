import { loadDotEnv, withTx } from '@imc/db';
import {
  billingService,
  LocalStorage,
  LogEmail,
  MockAuthAdmin,
  MockBilling,
  type Deps,
} from '@imc/domain';
import { asOwner, mintAdultJwt, testDatabaseUrls, truncateAppData } from '@imc/testing';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { buildDeps } from '../src/deps.js';
import { DEV_STAFF, seedContent, seedStaff } from '../src/seed.js';

loadDotEnv();
export const urls = testDatabaseUrls();

const silent = { info: () => {}, warn: () => {}, error: () => {} };

export interface TestEnv {
  app: FastifyInstance;
  deps: Deps & {
    billing: MockBilling;
    authAdmin: MockAuthAdmin;
    email: LogEmail;
    storage: LocalStorage;
  };
  config: Config;
  close(): Promise<void>;
}

export async function createTestEnv(overrides: Record<string, string> = {}): Promise<TestEnv> {
  const storageDir = mkdtempSync(join(tmpdir(), 'imc-storage-'));
  const config = loadConfig({
    ...process.env,
    ENVIRONMENT: 'test',
    DATABASE_URL: urls.runtimeUrl,
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: storageDir,
    BILLING_DRIVER: 'mock',
    LOG_LEVEL: 'silent',
    AUTH_JWKS_URL: '',
    ...overrides,
  });
  const base = buildDeps(config, silent);
  const deps = {
    ...base,
    billing: base.billing as MockBilling,
    authAdmin: new MockAuthAdmin(silent),
    email: new LogEmail(silent),
    storage: base.storage as LocalStorage,
  };
  const app = await buildApp(config, deps);
  return {
    app,
    deps,
    config,
    async close() {
      await app.close();
      await deps.pool.end();
    },
  };
}

/** Clears application data and re-creates the fixed dev staff accounts. */
export async function resetData() {
  await truncateAppData(urls.migrationUrl);
  await seedStaff(urls.migrationUrl);
}

/** Seeds original synthetic content through the real editorial workflow. */
export async function seedQuestions(env: TestEnv, perTopicPerGrade = 3) {
  return seedContent(env.deps, { perTopicPerGrade });
}

export async function adultToken(
  env: TestEnv,
  sub: string = randomUUID(),
  opts: { otpAgeSeconds?: number | null; aal?: 'aal1' | 'aal2' } = {},
) {
  return mintAdultJwt({
    secret: env.config.AUTH_JWT_SECRET,
    issuer: env.config.AUTH_ISSUER,
    audience: env.config.AUTH_AUDIENCE,
    sub,
    ...opts,
  });
}

export const staffToken = (env: TestEnv, role: keyof typeof DEV_STAFF) =>
  adultToken(env, DEV_STAFF[role]);

export interface CallResult<T> {
  status: number;
  body: {
    data: T;
    error?: { code: string; message: string; details?: unknown };
    requestId: string;
  };
  headers: Record<string, unknown>;
  raw: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function call<T = any>(
  env: TestEnv,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  url: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<CallResult<T>> {
  const res = await env.app.inject({
    method,
    url,
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...opts.headers,
    },
    payload: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return {
    status: res.statusCode,
    body: res.body ? res.json() : (undefined as never),
    headers: res.headers,
    raw: res.body,
  };
}

export interface Family {
  parentId: string;
  parent: string;
  studentId: string;
  child: string;
  childSessionId: string;
}

/** Parent signs in, creates a child, consents, and issues a child-mode token. */
export async function createFamily(
  env: TestEnv,
  opts: { grade?: number; timezone?: string } = {},
): Promise<Family> {
  const parentId = randomUUID();
  const parent = await adultToken(env, parentId);
  const s = await call(env, 'POST', '/v1/students', {
    token: parent,
    body: {
      nickname: 'Kid',
      avatarKey: 'owl',
      grade: opts.grade ?? 4,
      timezone: opts.timezone ?? 'Europe/London',
    },
  });
  if (s.status !== 201) throw new Error(`create student failed: ${s.raw}`);
  const studentId = s.body.data.id as string;
  await call(env, 'POST', '/v1/consents', {
    token: parent,
    body: { studentId, purpose: 'core_service', policyVersion: 'test-1', granted: true },
  });
  const cs = await call(env, 'POST', `/v1/students/${studentId}/child-sessions`, {
    token: parent,
    body: { deviceLabel: 'test device' },
  });
  if (cs.status !== 201) throw new Error(`child session failed: ${cs.raw}`);
  return {
    parentId,
    parent,
    studentId,
    child: cs.body.data.token,
    childSessionId: cs.body.data.sessionId,
  };
}

let keyCounter = 0;
export const idemKey = () => `test-key-${Date.now()}-${++keyCounter}`;

export function startSession(
  env: TestEnv,
  f: Family,
  body: { mode: 'daily' | 'topic' | 'mistakes'; topicId?: string } = { mode: 'daily' },
  key = idemKey(),
) {
  return call(env, 'POST', `/v1/students/${f.studentId}/sessions`, {
    token: f.child,
    body,
    headers: { 'idempotency-key': key },
  });
}

/** Reads an item's key via the owner connection. Test oracle only. */
export async function answerKeyForItem(itemId: string): Promise<string> {
  return asOwner(urls.migrationUrl, async (c) => {
    const { rows } = await c.query<{ k: string }>(
      `select k.correct_option_id as k from app.session_items i
         join private.answer_keys k on k.version_id = i.question_version_id where i.id = $1`,
      [itemId],
    );
    return rows[0]!.k;
  });
}

export async function wrongOptionFor(itemId: string, choices: string[]): Promise<string> {
  const key = await answerKeyForItem(itemId);
  return choices.find((c) => c !== key)!;
}

export async function grantPro(env: TestEnv, studentId: string, days = 30) {
  await withTx(env.deps.pool, { type: 'system', reason: 'test' }, (tx) =>
    billingService.grantPilotEntitlement(tx, {
      studentId,
      validUntil: new Date(Date.now() + days * 86_400_000),
      cohort: 'test',
    }),
  );
}

export async function setFlag(key: string, enabled: boolean) {
  await asOwner(urls.migrationUrl, (c) =>
    c.query(`update app.feature_flags set enabled = $2 where key = $1`, [key, enabled]),
  );
}

/** Answers every remaining item of a session; returns the final answer response. */
export async function completeSession(
  env: TestEnv,
  f: Family,
  sessionId: string,
  strategy: 'correct' | 'wrong' = 'correct',
) {
  let last: CallResult<any> | undefined;
  for (;;) {
    const state = await call(env, 'GET', `/v1/sessions/${sessionId}`, { token: f.child });
    const next = state.body.data.nextItemId as string | null;
    if (!next) return last;
    const item = await call(env, 'GET', `/v1/sessions/${sessionId}/items/${next}`, {
      token: f.child,
    });
    const choices = (item.body.data.options as Array<{ id: string }>).map((o) => o.id);
    const optionId =
      strategy === 'correct' ? await answerKeyForItem(next) : await wrongOptionFor(next, choices);
    last = await call(env, 'POST', `/v1/sessions/${sessionId}/items/${next}/answer`, {
      token: f.child,
      body: { optionId },
    });
    if (last.status !== 200) throw new Error(`answer failed: ${last.raw}`);
  }
}

export { DEV_STAFF };
