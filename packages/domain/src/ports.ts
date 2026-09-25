import type { Pool } from '@imc/db';

/** Private object storage. Every URL it returns is short-lived and signed. */
export interface StoragePort {
  readonly driver: string;
  signedDownloadUrl(
    objectKey: string,
    ttlSeconds: number,
  ): Promise<{ url: string; expiresAt: Date }>;
  signedUploadUrl(
    objectKey: string,
    opts: { mime: string; byteSize: number; ttlSeconds: number },
  ): Promise<{ url: string; expiresAt: Date }>;
  /** Returns size/mime/sha256 of a stored object, or null if absent. */
  inspect(objectKey: string): Promise<{ byteSize: number; mime: string; sha256: string } | null>;
  put(objectKey: string, body: Buffer, mime: string): Promise<void>;
  remove(objectKeys: string[]): Promise<void>;
}

export type ProviderSubscriptionStatus =
  'active' | 'trial' | 'cancelled' | 'grace' | 'billing_issue' | 'expired' | 'revoked' | 'refunded';

export interface ProviderSubscription {
  originalTransactionId: string;
  productId: string;
  status: ProviderSubscriptionStatus;
  expiresAt: Date | null;
  graceExpiresAt: Date | null;
}

/** Billing provider (RevenueCat in production). Verified provider state is the source of truth. */
export interface BillingPort {
  readonly provider: string;
  readonly enabled: boolean;
  /** Current verified state for a billing customer. Throws BillingUnavailableError on outage. */
  getCustomerSubscriptions(billingCustomerId: string): Promise<ProviderSubscription[]>;
  /** Authenticates a webhook request (Authorization header). */
  verifyWebhook(authorizationHeader: string | undefined): boolean;
  /** Extracts the event id/type/customer from a webhook payload. */
  parseWebhook(
    payload: unknown,
  ): { eventId: string; eventType: string; billingCustomerIds: string[] } | null;
}

export class BillingUnavailableError extends Error {
  constructor(message = 'Billing provider unavailable') {
    super(message);
    this.name = 'BillingUnavailableError';
  }
}

export interface EmailMessage {
  to: string;
  template: 'parent_summary' | 'deletion_complete' | 'export_ready';
  data: Record<string, unknown>;
  idempotencyKey: string;
}

export interface EmailPort {
  readonly driver: string;
  send(message: EmailMessage): Promise<void>;
}

/** Deletes an adult's Auth identity when account closure completes. */
export interface AuthAdminPort {
  readonly driver: string;
  deleteUser(accountId: string): Promise<void>;
  /** Verified email of an adult, fetched on demand (the app does not duplicate emails). */
  getUserEmail(accountId: string): Promise<string | null>;
}

export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface Deps {
  pool: Pool;
  storage: StoragePort;
  billing: BillingPort;
  email: EmailPort;
  authAdmin: AuthAdminPort;
  log: Logger;
  now?: () => Date;
}

export const consoleLogger: Logger = {
  info: (o, m) => console.log(JSON.stringify({ level: 'info', msg: m, ...o })),
  warn: (o, m) => console.warn(JSON.stringify({ level: 'warn', msg: m, ...o })),
  error: (o, m) => console.error(JSON.stringify({ level: 'error', msg: m, ...o })),
};
