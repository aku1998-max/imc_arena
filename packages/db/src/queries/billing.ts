import type { Tx } from '../context.js';

export interface EntitlementRow {
  id: string;
  accountId: string;
  studentId: string;
  featureSet: string;
  source: 'purchase' | 'pilot' | 'support';
  sourceId: string;
  validFrom: string;
  validUntil: string | null;
  revokedAt: string | null;
}

const ENT_COLS = `id, account_id as "accountId", student_id as "studentId", feature_set as "featureSet",
  source, source_id as "sourceId", valid_from as "validFrom", valid_until as "validUntil",
  revoked_at as "revokedAt"`;

export async function activeEntitlement(
  tx: Tx,
  studentId: string,
  featureSet = 'pro',
): Promise<EntitlementRow | null> {
  const { rows } = await tx.query<EntitlementRow>(
    `select ${ENT_COLS} from app.entitlements
      where student_id = $1 and feature_set = $2 and revoked_at is null
        and valid_from <= now() and (valid_until is null or valid_until > now())
      order by valid_until desc nulls first limit 1`,
    [studentId, featureSet],
  );
  return rows[0] ?? null;
}

export async function listEntitlementsForAccount(tx: Tx, accountId: string) {
  const { rows } = await tx.query<EntitlementRow>(
    `select ${ENT_COLS} from app.entitlements where account_id = $1
      order by valid_from desc, id`,
    [accountId],
  );
  return rows;
}

export async function upsertEntitlement(
  tx: Tx,
  input: {
    accountId: string;
    studentId: string;
    source: EntitlementRow['source'];
    sourceId: string;
    validFrom?: Date;
    validUntil: Date | null;
    revoked: boolean;
  },
): Promise<void> {
  await tx.query(
    `insert into app.entitlements (account_id, student_id, source, source_id, valid_from, valid_until, revoked_at)
     values ($1, $2, $3, $4, coalesce($5, now()), $6, case when $7 then now() end)
     on conflict (source, source_id, student_id) do update set
       valid_until = excluded.valid_until,
       revoked_at = case when $7 then coalesce(app.entitlements.revoked_at, now()) else null end`,
    [
      input.accountId,
      input.studentId,
      input.source,
      input.sourceId,
      input.validFrom ?? null,
      input.validUntil,
      input.revoked,
    ],
  );
}

export async function entitlementsForSubscription(tx: Tx, subscriptionId: string) {
  const { rows } = await tx.query<EntitlementRow>(
    `select ${ENT_COLS} from app.entitlements where source = 'purchase' and source_id = $1`,
    [subscriptionId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Subscriptions and purchase intents
// ---------------------------------------------------------------------------

export interface SubscriptionRow {
  id: string;
  accountId: string;
  providerCustomerId: string;
  originalTransactionId: string;
  productId: string;
  status: string;
  expiresAt: string | null;
  graceExpiresAt: string | null;
}

const SUB_COLS = `id, account_id as "accountId", provider_customer_id as "providerCustomerId",
  original_transaction_id as "originalTransactionId", product_id as "productId", status,
  expires_at as "expiresAt", grace_expires_at as "graceExpiresAt"`;

export async function findSubscriptionByTransaction(
  tx: Tx,
  provider: string,
  originalTransactionId: string,
): Promise<SubscriptionRow | null> {
  const { rows } = await tx.query<SubscriptionRow>(
    `select ${SUB_COLS} from app.subscriptions where provider = $1 and original_transaction_id = $2
     for update`,
    [provider, originalTransactionId],
  );
  return rows[0] ?? null;
}

export async function insertSubscription(
  tx: Tx,
  input: {
    accountId: string;
    provider: string;
    providerCustomerId: string;
    originalTransactionId: string;
    productId: string;
    status: string;
    expiresAt: Date | null;
    graceExpiresAt: Date | null;
  },
): Promise<SubscriptionRow> {
  const { rows } = await tx.query<SubscriptionRow>(
    `insert into app.subscriptions (account_id, provider, provider_customer_id, original_transaction_id,
        product_id, status, expires_at, grace_expires_at, last_verified_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now()) returning ${SUB_COLS}`,
    [
      input.accountId,
      input.provider,
      input.providerCustomerId,
      input.originalTransactionId,
      input.productId,
      input.status,
      input.expiresAt,
      input.graceExpiresAt,
    ],
  );
  return rows[0]!;
}

export async function updateSubscriptionState(
  tx: Tx,
  id: string,
  input: { status: string; expiresAt: Date | null; graceExpiresAt: Date | null; productId: string },
) {
  await tx.query(
    `update app.subscriptions set status = $2, expires_at = $3, grace_expires_at = $4,
            product_id = $5, last_verified_at = now()
      where id = $1`,
    [id, input.status, input.expiresAt, input.graceExpiresAt, input.productId],
  );
}

export async function subscriptionsNeedingReconciliation(
  tx: Tx,
  staleHours: number,
  limit: number,
) {
  const { rows } = await tx.query<{ accountId: string }>(
    `select distinct account_id as "accountId" from app.subscriptions
      where last_verified_at < now() - make_interval(hours => $1)
         or (expires_at is not null and expires_at < now() and status in ('active', 'trial', 'cancelled', 'grace'))
      limit $2`,
    [staleHours, limit],
  );
  return rows.map((r) => r.accountId);
}

export interface PurchaseIntentRow {
  id: string;
  accountId: string;
  studentId: string;
  productId: string;
  status: 'pending' | 'bound' | 'expired' | 'ambiguous';
  subscriptionId: string | null;
  expiresAt: string;
}

const INTENT_COLS = `id, account_id as "accountId", student_id as "studentId",
  product_id as "productId", status, subscription_id as "subscriptionId", expires_at as "expiresAt"`;

export async function insertPurchaseIntent(
  tx: Tx,
  input: { accountId: string; studentId: string; productId: string; expiresAt: Date },
): Promise<PurchaseIntentRow> {
  const { rows } = await tx.query<PurchaseIntentRow>(
    `insert into app.purchase_intents (account_id, student_id, product_id, expires_at)
     values ($1, $2, $3, $4) returning ${INTENT_COLS}`,
    [input.accountId, input.studentId, input.productId, input.expiresAt],
  );
  return rows[0]!;
}

export async function openIntentsForProduct(tx: Tx, accountId: string, productId: string) {
  const { rows } = await tx.query<PurchaseIntentRow>(
    `select ${INTENT_COLS} from app.purchase_intents
      where account_id = $1 and product_id = $2 and status in ('pending', 'ambiguous')
        and expires_at > now() - interval '7 days'
      order by created_at desc for update`,
    [accountId, productId],
  );
  return rows;
}

export async function setIntentStatus(
  tx: Tx,
  id: string,
  status: PurchaseIntentRow['status'],
  subscriptionId: string | null,
) {
  await tx.query(
    `update app.purchase_intents set status = $2, subscription_id = coalesce($3, subscription_id)
      where id = $1`,
    [id, status, subscriptionId],
  );
}

export async function countPendingIntents(tx: Tx, accountId: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `select count(*)::int as n from app.purchase_intents
      where account_id = $1 and status in ('pending', 'ambiguous') and expires_at > now()`,
    [accountId],
  );
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Provider events
// ---------------------------------------------------------------------------

export async function insertBillingEvent(
  tx: Tx,
  input: {
    provider: string;
    eventId: string;
    eventType: string;
    appUserId: string | null;
    payloadHash: string;
    payload: unknown;
  },
): Promise<boolean> {
  const { rowCount } = await tx.query(
    `insert into app.billing_events (provider, event_id, event_type, app_user_id, payload_hash, payload)
     values ($1, $2, $3, $4, $5, $6) on conflict (provider, event_id) do nothing`,
    [
      input.provider,
      input.eventId,
      input.eventType,
      input.appUserId,
      input.payloadHash,
      JSON.stringify(input.payload),
    ],
  );
  return (rowCount ?? 0) === 1;
}

export async function findBillingEvent(tx: Tx, provider: string, eventId: string) {
  const { rows } = await tx.query<{
    appUserId: string | null;
    eventType: string;
    processingStatus: string;
  }>(
    `select app_user_id as "appUserId", event_type as "eventType",
            processing_status as "processingStatus"
       from app.billing_events where provider = $1 and event_id = $2 for update`,
    [provider, eventId],
  );
  return rows[0] ?? null;
}

export async function markBillingEvent(
  tx: Tx,
  provider: string,
  eventId: string,
  status: 'processed' | 'failed' | 'ignored',
) {
  await tx.query(
    `update app.billing_events set processing_status = $3, processed_at = now()
      where provider = $1 and event_id = $2`,
    [provider, eventId, status],
  );
}

/** Subscriptions the provider no longer reports for this customer lose access. */
export async function revokeUnreportedSubscriptions(
  tx: Tx,
  input: { accountId: string; provider: string; reportedIds: string[] },
): Promise<number> {
  const { rows } = await tx.query<{ id: string }>(
    `update app.subscriptions set status = 'revoked', last_verified_at = now()
      where account_id = $1 and provider = $2 and not (id = any($3::uuid[]))
        and status not in ('expired', 'revoked', 'refunded')
      returning id`,
    [input.accountId, input.provider, input.reportedIds],
  );
  if (rows.length) {
    await tx.query(
      `update app.entitlements set revoked_at = coalesce(revoked_at, now())
        where source = 'purchase' and source_id = any($1::text[])`,
      [rows.map((r) => r.id)],
    );
  }
  return rows.length;
}
