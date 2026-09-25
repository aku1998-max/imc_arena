import { jobs, mapRevenueCatSubscription } from '@imc/domain';
import { asOwner } from '@imc/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  createFamily,
  createTestEnv,
  resetData,
  seedQuestions,
  setFlag,
  startSession,
  urls,
  type Family,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;

beforeAll(async () => {
  await resetData();
  env = await createTestEnv({ BILLING_PRODUCT_IDS: 'imc_pro_monthly,imc_pro_annual' });
  await seedQuestions(env, 6);
});
afterAll(async () => env.close());
beforeEach(async () => {
  env.deps.billing.reset();
  await setFlag('billing', true);
});

const future = (days: number) => new Date(Date.now() + days * 86_400_000);

async function billingCustomerId(f: Family) {
  return asOwner(
    urls.migrationUrl,
    async (c) =>
      (await c.query(`select billing_customer_id from app.accounts where id = $1`, [f.parentId]))
        .rows[0].billing_customer_id as string,
  );
}

async function purchaseIntent(f: Family, productId = 'imc_pro_monthly') {
  const g = await call(env, 'POST', '/v1/adult-grants', {
    token: f.parent,
    body: { action: 'purchase', targetId: f.studentId },
  });
  return call(env, 'POST', '/v1/billing/purchase-intents', {
    token: f.parent,
    body: { studentId: f.studentId, productId },
    headers: { 'x-adult-grant': g.body.data.grant },
  });
}

async function topicStart(f: Family) {
  const topics = await call(env, 'GET', '/v1/topics?grade=4', { token: f.child });
  const topicId = topics.body.data.topics.find(
    (t: { inventory: string }) => t.inventory !== 'unavailable',
  ).id;
  return startSession(env, f, { mode: 'topic', topicId });
}

const webhook = (
  eventId: string,
  customer: string,
  type = 'RENEWAL',
  auth = env.config.BILLING_WEBHOOK_SECRET,
) =>
  call(env, 'POST', '/webhooks/revenuecat', {
    body: {
      api_version: '1.0',
      event: { id: eventId, type, app_user_id: customer, aliases: [customer] },
    },
    headers: { authorization: `Bearer ${auth}` },
  });

const drain = async () => {
  while ((await jobs.runJobsOnce(env.deps)).claimed > 0) {
    /* drain */
  }
};

describe('purchase and restore', () => {
  it('purchase requires billing enabled, a fresh grant and a known product', async () => {
    const f = await createFamily(env);
    await setFlag('billing', false);
    expect((await purchaseIntent(f)).body.error!.code).toBe('FEATURE_DISABLED');
    await setFlag('billing', true);
    const noGrant = await call(env, 'POST', '/v1/billing/purchase-intents', {
      token: f.parent,
      body: { studentId: f.studentId, productId: 'imc_pro_monthly' },
    });
    expect(noGrant.body.error!.code).toBe('REAUTH_REQUIRED');
    expect((await purchaseIntent(f, 'unknown_product')).status).toBe(400);
    const ok = await purchaseIntent(f);
    expect(ok.status).toBe(201);
    expect(ok.body.data.billingCustomerId).toBe(await billingCustomerId(f));
  });

  it('a client success callback alone does not grant Pro; verified provider state does', async () => {
    const f = await createFamily(env);
    await purchaseIntent(f);
    expect((await topicStart(f)).status).toBe(403);
    env.deps.billing.setSubscription(await billingCustomerId(f), {
      originalTransactionId: 'txn-1',
      productId: 'imc_pro_monthly',
      status: 'active',
      expiresAt: future(30),
      graceExpiresAt: null,
    });
    // Still nothing until the backend verifies (restore or webhook).
    expect((await topicStart(f)).status).toBe(403);
    const restore = await call(env, 'POST', '/v1/billing/restore', { token: f.parent, body: {} });
    expect(restore.status).toBe(200);
    expect(restore.body.data.entitlements).toHaveLength(1);
    expect(restore.body.data.entitlements[0]).toMatchObject({
      studentId: f.studentId,
      source: 'purchase',
      revokedAt: null,
    });
    expect((await topicStart(f)).status).toBe(201);
    // Restore again: idempotent, original binding kept.
    const again = await call(env, 'POST', '/v1/billing/restore', { token: f.parent, body: {} });
    expect(again.body.data.entitlements).toHaveLength(1);
  });

  it('the entitlement belongs to the selected child only', async () => {
    const f = await createFamily(env);
    const s2 = await call(env, 'POST', '/v1/students', {
      token: f.parent,
      body: { nickname: 'Sib', avatarKey: 'cat', grade: 4, timezone: 'UTC' },
    });
    await purchaseIntent(f);
    env.deps.billing.setSubscription(await billingCustomerId(f), {
      originalTransactionId: 'txn-sibling',
      productId: 'imc_pro_monthly',
      status: 'active',
      expiresAt: future(30),
      graceExpiresAt: null,
    });
    const r = await call(env, 'POST', '/v1/billing/restore', { token: f.parent, body: {} });
    expect(r.body.data.entitlements.map((e: { studentId: string }) => e.studentId)).toEqual([
      f.studentId,
    ]);
    expect(r.body.data.entitlements.map((e: { studentId: string }) => e.studentId)).not.toContain(
      s2.body.data.id,
    );
  });

  it('an unmatched purchase stays pending for support instead of being auto-assigned', async () => {
    const f = await createFamily(env);
    env.deps.billing.setSubscription(await billingCustomerId(f), {
      originalTransactionId: 'txn-unmatched',
      productId: 'imc_pro_annual',
      status: 'active',
      expiresAt: future(300),
      graceExpiresAt: null,
    });
    const r = await call(env, 'POST', '/v1/billing/restore', { token: f.parent, body: {} });
    expect(r.body.data.entitlements).toHaveLength(0);
    const alerts = await asOwner(
      urls.migrationUrl,
      async (c) =>
        (
          await c.query(
            `select count(*)::int as n from app.ops_alerts where kind = 'billing_mismatch'`,
          )
        ).rows[0].n,
    );
    expect(alerts).toBeGreaterThanOrEqual(1);
  });

  it('the same store purchase cannot fund a second family', async () => {
    const a = await createFamily(env);
    const b = await createFamily(env);
    await purchaseIntent(a);
    await purchaseIntent(b);
    const sub = {
      originalTransactionId: 'txn-shared',
      productId: 'imc_pro_monthly',
      status: 'active' as const,
      expiresAt: future(30),
      graceExpiresAt: null,
    };
    env.deps.billing.setSubscription(await billingCustomerId(a), sub);
    await call(env, 'POST', '/v1/billing/restore', { token: a.parent, body: {} });
    // Store transfers the purchase to B's customer id (e.g. restore on another account).
    env.deps.billing.moveSubscription(
      await billingCustomerId(a),
      await billingCustomerId(b),
      'txn-shared',
    );
    const rb = await call(env, 'POST', '/v1/billing/restore', { token: b.parent, body: {} });
    expect(rb.body.data.entitlements).toHaveLength(0);
    // A's entitlement is revoked because the provider no longer reports it for A.
    const ra = await call(env, 'POST', '/v1/billing/restore', { token: a.parent, body: {} });
    expect(ra.body.data.entitlements[0].revokedAt).not.toBeNull();
  });
});

describe('webhooks and reconciliation', () => {
  it('authenticates, deduplicates and converges duplicate/out-of-order/refund events', async () => {
    const f = await createFamily(env);
    const customer = await billingCustomerId(f);
    await purchaseIntent(f);
    expect(
      (await webhook('evt-bad', customer, 'INITIAL_PURCHASE', 'wrong-secret-value')).status,
    ).toBe(401);

    env.deps.billing.setSubscription(customer, {
      originalTransactionId: 'txn-w',
      productId: 'imc_pro_monthly',
      status: 'active',
      expiresAt: future(30),
      graceExpiresAt: null,
    });
    const first = await webhook('evt-1', customer, 'INITIAL_PURCHASE');
    expect(first.body.data).toEqual({ received: true, duplicate: false });
    expect((await webhook('evt-1', customer, 'INITIAL_PURCHASE')).body.data.duplicate).toBe(true);
    await drain();
    expect((await topicStart(f)).status).toBe(201);

    // Refund happens at the provider; a late RENEWAL event arrives after the CANCELLATION one.
    env.deps.billing.setSubscription(customer, {
      originalTransactionId: 'txn-w',
      productId: 'imc_pro_monthly',
      status: 'refunded',
      expiresAt: future(30),
      graceExpiresAt: null,
    });
    await webhook('evt-3', customer, 'CANCELLATION');
    await webhook('evt-2', customer, 'RENEWAL');
    await drain();
    const ents = await call(env, 'GET', '/v1/billing/entitlements', { token: f.parent });
    expect(ents.body.data.entitlements[0].revokedAt).not.toBeNull();
    const count = await asOwner(
      urls.migrationUrl,
      async (c) =>
        (
          await c.query(
            `select count(*)::int as n from app.billing_events where processing_status = 'processed'`,
          )
        ).rows[0].n,
    );
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('an expired paid grant cannot start a new Pro session; cancelled access lasts until expiry', async () => {
    const f = await createFamily(env);
    const customer = await billingCustomerId(f);
    await purchaseIntent(f);
    env.deps.billing.setSubscription(customer, {
      originalTransactionId: 'txn-exp',
      productId: 'imc_pro_monthly',
      status: 'cancelled',
      expiresAt: future(3),
      graceExpiresAt: null,
    });
    await call(env, 'POST', '/v1/billing/restore', { token: f.parent, body: {} });
    const started = await topicStart(f);
    expect(started.status).toBe(201);
    // Time passes: the stored paid-through date lapses.
    await asOwner(urls.migrationUrl, (c) =>
      c.query(
        `update app.entitlements set valid_until = now() - interval '1 minute' where student_id = $1`,
        [f.studentId],
      ),
    );
    await asOwner(urls.migrationUrl, (c) =>
      c.query(`update app.practice_sessions set status = 'abandoned' where student_id = $1`, [
        f.studentId,
      ]),
    );
    const denied = await topicStart(f);
    expect(denied.status).toBe(403);
    expect(denied.body.error!.code).toBe('ENTITLEMENT_REQUIRED');
  });

  it('provider outage: last verified entitlement is honoured until stored expiry; restore fails closed', async () => {
    const f = await createFamily(env);
    const customer = await billingCustomerId(f);
    await purchaseIntent(f);
    env.deps.billing.setSubscription(customer, {
      originalTransactionId: 'txn-outage',
      productId: 'imc_pro_monthly',
      status: 'active',
      expiresAt: future(10),
      graceExpiresAt: null,
    });
    await call(env, 'POST', '/v1/billing/restore', { token: f.parent, body: {} });
    env.deps.billing.unavailable = true;
    const restore = await call(env, 'POST', '/v1/billing/restore', { token: f.parent, body: {} });
    expect(restore.status).toBe(503);
    expect((await topicStart(f)).status).toBe(201);
  });

  it('grace uses only the provider grace timestamp', async () => {
    const f = await createFamily(env);
    const customer = await billingCustomerId(f);
    await purchaseIntent(f);
    const grace = future(2);
    env.deps.billing.setSubscription(customer, {
      originalTransactionId: 'txn-grace',
      productId: 'imc_pro_monthly',
      status: 'grace',
      expiresAt: future(-1),
      graceExpiresAt: grace,
    });
    const r = await call(env, 'POST', '/v1/billing/restore', { token: f.parent, body: {} });
    expect(new Date(r.body.data.entitlements[0].validUntil).toISOString()).toBe(
      grace.toISOString(),
    );
  });
});

describe('RevenueCat mapping', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  it('maps provider records to verified states', () => {
    const base = {
      expires_date: '2026-10-25T12:00:00Z',
      original_purchase_date: '2026-09-01T00:00:00Z',
      store: 'app_store',
    };
    expect(mapRevenueCatSubscription('p', base, now).status).toBe('active');
    expect(mapRevenueCatSubscription('p', { ...base, period_type: 'trial' }, now).status).toBe(
      'trial',
    );
    expect(
      mapRevenueCatSubscription(
        'p',
        { ...base, unsubscribe_detected_at: '2026-09-20T00:00:00Z' },
        now,
      ).status,
    ).toBe('cancelled');
    expect(
      mapRevenueCatSubscription('p', { ...base, refunded_at: '2026-09-20T00:00:00Z' }, now).status,
    ).toBe('refunded');
    expect(
      mapRevenueCatSubscription('p', { ...base, expires_date: '2026-09-20T00:00:00Z' }, now).status,
    ).toBe('expired');
    expect(
      mapRevenueCatSubscription(
        'p',
        {
          ...base,
          expires_date: '2026-09-20T00:00:00Z',
          grace_period_expires_date: '2026-09-30T00:00:00Z',
        },
        now,
      ).status,
    ).toBe('grace');
    expect(mapRevenueCatSubscription('p', base, now).originalTransactionId).toBe(
      'app_store:p:2026-09-01T00:00:00Z',
    );
  });
});
