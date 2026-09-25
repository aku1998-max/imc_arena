import { accounts, billing, ops, type Pool, type Tx, withTx } from '@imc/db';
import { productDefaults } from '../config.js';
import { canonicalJson, sha256Hex } from '../crypto.js';
import { DomainError, notFound } from '../errors.js';
import { BillingUnavailableError, type BillingPort, type ProviderSubscription } from '../ports.js';
import { audit, requireAdult, track } from './common.js';
import { consumeAdultGrant } from './identity.js';

const system = (reason: string) => ({ type: 'system' as const, reason });

async function billingEnabled(tx: Tx, port: BillingPort) {
  const flags = await ops.getFlags(tx);
  return port.enabled && flags.billing === true;
}

export async function listEntitlements(tx: Tx, port: BillingPort) {
  const accountId = requireAdult(tx);
  return {
    billingEnabled: await billingEnabled(tx, port),
    entitlements: await billing.listEntitlementsForAccount(tx, accountId),
    pendingPurchases: await billing.countPendingIntents(tx, accountId),
  };
}

/** Freshly authenticated adult binds the purchase to one selected child before the store flow. */
export async function createPurchaseIntent(
  tx: Tx,
  port: BillingPort,
  productIds: string[],
  input: { studentId: string; productId: string; grant: string | undefined },
  now = new Date(),
) {
  const accountId = requireAdult(tx);
  if (!(await billingEnabled(tx, port))) {
    throw new DomainError('FEATURE_DISABLED', 'Purchases are not available yet.');
  }
  if (!productIds.includes(input.productId)) {
    throw new DomainError('VALIDATION_FAILED', 'Unknown product.');
  }
  const student = await accounts.findStudent(tx, input.studentId);
  if (!student || student.status !== 'active') throw notFound('Child profile');
  await consumeAdultGrant(tx, input.grant, 'purchase', input.studentId);
  const account = (await accounts.findAccount(tx, accountId))!;
  const intent = await billing.insertPurchaseIntent(tx, {
    accountId,
    studentId: input.studentId,
    productId: input.productId,
    expiresAt: new Date(now.getTime() + productDefaults.purchaseIntentMinutes * 60_000),
  });
  await audit(
    tx,
    'purchase_intent.created',
    { type: 'student', id: input.studentId },
    {
      metadata: { intentId: intent.id, productId: input.productId },
    },
  );
  return {
    intentId: intent.id,
    billingCustomerId: account.billingCustomerId,
    productId: intent.productId,
    expiresAt: intent.expiresAt,
  };
}

function accessWindow(sub: ProviderSubscription): { validUntil: Date | null; revoked: boolean } {
  switch (sub.status) {
    case 'active':
    case 'trial':
    case 'cancelled':
    case 'billing_issue':
      return { validUntil: sub.expiresAt, revoked: false };
    case 'grace':
      // Only the provider's verified grace timestamp; never an invented extension.
      return { validUntil: sub.graceExpiresAt, revoked: !sub.graceExpiresAt };
    default:
      return { validUntil: sub.expiresAt, revoked: true };
  }
}

export interface ReconcileSummary {
  accountId: string;
  verified: number;
  bound: number;
  unbound: number;
  conflicts: number;
}

/**
 * Converges stored subscriptions/entitlements to verified provider state for one account.
 * A client success callback never grants access; only this path does. Idempotent: duplicate or
 * out-of-order events simply trigger another convergence.
 */
export async function reconcileAccount(
  pool: Pool,
  port: BillingPort,
  accountId: string,
): Promise<ReconcileSummary> {
  const account = await withTx(pool, system('billing-reconcile'), (tx) =>
    accounts.findAccount(tx, accountId),
  );
  if (!account) throw notFound('Account');
  // Network call happens outside the transaction.
  const subs = await port.getCustomerSubscriptions(account.billingCustomerId);

  return withTx(pool, system('billing-reconcile'), async (tx) => {
    const summary: ReconcileSummary = {
      accountId,
      verified: subs.length,
      bound: 0,
      unbound: 0,
      conflicts: 0,
    };
    const seen = new Set<string>();
    for (const sub of subs) {
      let row = await billing.findSubscriptionByTransaction(
        tx,
        port.provider,
        sub.originalTransactionId,
      );
      if (row && row.accountId !== accountId) {
        // The same store purchase already funds another family: never auto-reassign.
        summary.conflicts++;
        await ops.raiseOpsAlert(tx, {
          kind: 'billing_mismatch',
          dedupeKey: `billing-conflict:${port.provider}:${sub.originalTransactionId}`,
          details: { reason: 'transaction bound to another account', subscriptionId: row.id },
        });
        continue;
      }
      if (!row) {
        row = await billing.insertSubscription(tx, {
          accountId,
          provider: port.provider,
          providerCustomerId: account.billingCustomerId,
          originalTransactionId: sub.originalTransactionId,
          productId: sub.productId,
          status: sub.status,
          expiresAt: sub.expiresAt,
          graceExpiresAt: sub.graceExpiresAt,
        });
      } else {
        await billing.updateSubscriptionState(tx, row.id, sub);
      }
      seen.add(row.id);
      const window = accessWindow(sub);
      const existing = await billing.entitlementsForSubscription(tx, row.id);
      if (existing.length > 0) {
        for (const e of existing) {
          await billing.upsertEntitlement(tx, {
            accountId,
            studentId: e.studentId,
            source: 'purchase',
            sourceId: row.id,
            validUntil: window.validUntil,
            revoked: window.revoked,
          });
        }
        continue;
      }
      if (window.revoked) continue;
      const intents = await billing.openIntentsForProduct(tx, accountId, sub.productId);
      const pending = intents.filter((i) => i.status === 'pending');
      if (pending.length === 1) {
        const intent = pending[0]!;
        await billing.upsertEntitlement(tx, {
          accountId,
          studentId: intent.studentId,
          source: 'purchase',
          sourceId: row.id,
          validUntil: window.validUntil,
          revoked: false,
        });
        await billing.setIntentStatus(tx, intent.id, 'bound', row.id);
        await audit(
          tx,
          'entitlement.granted',
          { type: 'student', id: intent.studentId },
          {
            metadata: { subscriptionId: row.id, intentId: intent.id, productId: sub.productId },
          },
        );
        await track(tx, 'purchase_verified', null, {
          productId: sub.productId,
          providerEventRef: row.id,
        });
        summary.bound++;
      } else {
        // Unmatched or ambiguous: stays pending for reconciliation/support.
        for (const i of pending) await billing.setIntentStatus(tx, i.id, 'ambiguous', null);
        summary.unbound++;
        await ops.raiseOpsAlert(tx, {
          kind: 'billing_mismatch',
          dedupeKey: `billing-unbound:${row.id}`,
          details: {
            reason: pending.length ? 'ambiguous intents' : 'no purchase intent',
            subscriptionId: row.id,
          },
        });
      }
    }
    await billing.revokeUnreportedSubscriptions(tx, {
      accountId,
      provider: port.provider,
      reportedIds: [...seen],
    });
    return summary;
  });
}

/** Webhook intake: authenticate, persist unique event id, enqueue durable processing, ack. */
export async function ingestWebhook(
  pool: Pool,
  port: BillingPort,
  input: { authorization: string | undefined; payload: unknown },
) {
  if (!port.verifyWebhook(input.authorization)) {
    throw new DomainError('UNAUTHENTICATED', 'Invalid webhook credentials.');
  }
  const parsed = port.parseWebhook(input.payload);
  if (!parsed) throw new DomainError('VALIDATION_FAILED', 'Unrecognised webhook payload.');
  return withTx(pool, system('billing-webhook'), async (tx) => {
    const inserted = await billing.insertBillingEvent(tx, {
      provider: port.provider,
      eventId: parsed.eventId,
      eventType: parsed.eventType,
      appUserId: parsed.billingCustomerIds[0] ?? null,
      payloadHash: sha256Hex(canonicalJson(input.payload)),
      payload: input.payload,
    });
    if (inserted) {
      await ops.enqueueJob(tx, {
        type: 'billing.event',
        dedupeKey: `billing-event:${port.provider}:${parsed.eventId}`,
        payload: {
          provider: port.provider,
          eventId: parsed.eventId,
          customers: parsed.billingCustomerIds,
        },
      });
    }
    return { duplicate: !inserted };
  });
}

export async function processBillingEvent(
  pool: Pool,
  port: BillingPort,
  payload: { provider: string; eventId: string; customers: string[] },
) {
  const accountIds = await withTx(pool, system('billing-event'), async (tx) => {
    const ids: string[] = [];
    for (const c of payload.customers) {
      const acct = await accounts.findAccountByBillingCustomer(tx, c);
      if (acct) ids.push(acct.id);
    }
    return ids;
  });
  for (const id of accountIds) await reconcileAccount(pool, port, id);
  await withTx(pool, system('billing-event'), (tx) =>
    billing.markBillingEvent(
      tx,
      payload.provider,
      payload.eventId,
      accountIds.length ? 'processed' : 'ignored',
    ),
  );
}

/** Scheduled repair of missed events and lapsed entitlements. */
export async function billingSweep(
  pool: Pool,
  port: BillingPort,
  log: (m: string) => void = () => {},
) {
  const accountIds = await withTx(pool, system('billing-sweep'), (tx) =>
    billing.subscriptionsNeedingReconciliation(tx, 24, 200),
  );
  let failures = 0;
  for (const id of accountIds) {
    try {
      await reconcileAccount(pool, port, id);
    } catch (err) {
      failures++;
      if (!(err instanceof BillingUnavailableError)) throw err;
      log(`billing provider unavailable during sweep for ${id}`);
    }
  }
  return { checked: accountIds.length, failures };
}

export async function restorePurchases(pool: Pool, port: BillingPort, accountId: string) {
  try {
    return await reconcileAccount(pool, port, accountId);
  } catch (err) {
    if (err instanceof BillingUnavailableError) {
      throw new DomainError(
        'SERVICE_UNAVAILABLE',
        'The store could not be reached. Please try again.',
      );
    }
    throw err;
  }
}

/** Pilot access without a purchase: an expiring entitlement for one child (operator action). */
export async function grantPilotEntitlement(
  tx: Tx,
  input: { studentId: string; validUntil: Date; cohort: string },
) {
  const [accountId] = await accounts.guardianAccountsOf(tx, input.studentId);
  if (!accountId) throw notFound('Child profile');
  await billing.upsertEntitlement(tx, {
    accountId,
    studentId: input.studentId,
    source: 'pilot',
    sourceId: `pilot:${input.cohort}`,
    validUntil: input.validUntil,
    revoked: false,
  });
  await audit(
    tx,
    'entitlement.pilot_granted',
    { type: 'student', id: input.studentId },
    {
      metadata: { cohort: input.cohort, validUntil: input.validUntil.toISOString() },
    },
  );
}
