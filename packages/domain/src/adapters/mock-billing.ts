import { BillingUnavailableError, type BillingPort, type ProviderSubscription } from '../ports.js';
import { parseRevenueCatWebhook, verifyAuthorizationHeader } from './billing-common.js';

/**
 * EXPLICIT MOCK billing provider for local development and automated tests. It never contacts a
 * store and never charges anyone. It simulates provider state so purchase/restore/refund/expiry
 * reconciliation can be exercised end to end. Not selectable in production.
 */
export class MockBilling implements BillingPort {
  readonly provider = 'mock';
  private readonly customers = new Map<string, ProviderSubscription[]>();
  unavailable = false;

  constructor(
    private readonly webhookSecret: string,
    readonly enabled = true,
  ) {}

  async getCustomerSubscriptions(billingCustomerId: string) {
    if (this.unavailable) throw new BillingUnavailableError();
    return (this.customers.get(billingCustomerId) ?? []).map((s) => ({ ...s }));
  }

  verifyWebhook(header: string | undefined) {
    return verifyAuthorizationHeader(this.webhookSecret, header);
  }

  parseWebhook(payload: unknown) {
    return parseRevenueCatWebhook(payload);
  }

  /** Test/dev helper: simulate a completed store purchase or a provider-side state change. */
  setSubscription(billingCustomerId: string, sub: ProviderSubscription) {
    const list = this.customers.get(billingCustomerId) ?? [];
    const idx = list.findIndex((s) => s.originalTransactionId === sub.originalTransactionId);
    if (idx >= 0) list[idx] = sub;
    else list.push(sub);
    this.customers.set(billingCustomerId, list);
  }

  /** Simulates a store-side transfer (e.g. restore on another account). */
  moveSubscription(from: string, to: string, originalTransactionId: string) {
    const src = this.customers.get(from) ?? [];
    const sub = src.find((s) => s.originalTransactionId === originalTransactionId);
    if (!sub) return;
    this.customers.set(
      from,
      src.filter((s) => s !== sub),
    );
    this.setSubscription(to, sub);
  }

  reset() {
    this.customers.clear();
    this.unavailable = false;
  }
}
