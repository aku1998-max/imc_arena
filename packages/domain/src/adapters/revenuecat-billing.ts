import {
  BillingUnavailableError,
  type BillingPort,
  type ProviderSubscription,
  type ProviderSubscriptionStatus,
} from '../ports.js';
import { parseRevenueCatWebhook, verifyAuthorizationHeader } from './billing-common.js';

interface RcSubscription {
  expires_date: string | null;
  original_purchase_date?: string;
  period_type?: string;
  store?: string;
  unsubscribe_detected_at?: string | null;
  billing_issues_detected_at?: string | null;
  grace_period_expires_date?: string | null;
  refunded_at?: string | null;
  store_transaction_id?: string;
}

const date = (v: string | null | undefined) => (v ? new Date(v) : null);

/** Maps one RevenueCat subscription record to our verified status. Exported for tests. */
export function mapRevenueCatSubscription(
  productId: string,
  s: RcSubscription,
  now = new Date(),
): ProviderSubscription {
  const expiresAt = date(s.expires_date);
  const graceExpiresAt = date(s.grace_period_expires_date);
  let status: ProviderSubscriptionStatus;
  if (s.refunded_at) status = 'refunded';
  else if (expiresAt && expiresAt <= now) {
    status = graceExpiresAt && graceExpiresAt > now ? 'grace' : 'expired';
  } else if (s.billing_issues_detected_at) status = 'billing_issue';
  else if (s.unsubscribe_detected_at) status = 'cancelled';
  else if (s.period_type === 'trial') status = 'trial';
  else status = 'active';
  return {
    // Stable identity of the original purchase for this store subscription.
    originalTransactionId: `${s.store ?? 'store'}:${productId}:${s.original_purchase_date ?? 'unknown'}`,
    productId,
    status,
    expiresAt,
    graceExpiresAt,
  };
}

/**
 * RevenueCat adapter (introduced at the paid gate). Uses the REST v1 subscriber endpoint with the
 * secret API key. Verify field semantics against the RevenueCat API version in use during sandbox
 * testing before paid launch (docs/decisions.md, D-015).
 */
export class RevenueCatBilling implements BillingPort {
  readonly provider = 'revenuecat';

  constructor(
    private readonly apiKey: string,
    private readonly webhookSecret: string,
    private readonly productIds: string[],
    readonly enabled = true,
    private readonly baseUrl = 'https://api.revenuecat.com',
  ) {}

  async getCustomerSubscriptions(billingCustomerId: string): Promise<ProviderSubscription[]> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/subscribers/${encodeURIComponent(billingCustomerId)}`, {
        headers: { authorization: `Bearer ${this.apiKey}`, accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new BillingUnavailableError((err as Error).message);
    }
    if (res.status >= 500 || res.status === 429)
      throw new BillingUnavailableError(`status ${res.status}`);
    if (!res.ok) throw new Error(`RevenueCat request failed: ${res.status}`);
    const body = (await res.json()) as {
      subscriber?: { subscriptions?: Record<string, RcSubscription> };
    };
    const subs = body.subscriber?.subscriptions ?? {};
    return Object.entries(subs)
      .filter(([productId]) => this.productIds.includes(productId))
      .map(([productId, s]) => mapRevenueCatSubscription(productId, s));
  }

  verifyWebhook(header: string | undefined) {
    return verifyAuthorizationHeader(this.webhookSecret, header);
  }

  parseWebhook(payload: unknown) {
    return parseRevenueCatWebhook(payload);
  }
}
