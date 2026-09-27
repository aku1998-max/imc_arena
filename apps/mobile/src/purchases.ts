import { Platform } from 'react-native';
import { PRO_PRODUCT_ID, REVENUECAT_ANDROID_KEY, REVENUECAT_IOS_KEY } from './config';
import type { ApiClient } from './lib/api-client';

/**
 * Store purchase adapter. Access is granted only after the backend verifies provider state; the
 * store's success callback alone never unlocks Pro.
 *
 * Development builds use the API's mock store. Store builds use RevenueCat with
 * appUserID = billingCustomerId, and the caller then calls POST /v1/billing/restore so the backend
 * re-reads verified provider state. See docs/runbooks/paid-gate.md.
 */

type PurchasesModule = typeof import('react-native-purchases').default;

const USE_MOCK_STORE = __DEV__ && process.env.EXPO_PUBLIC_REAL_STORE !== 'true';

export class PurchaseCancelledError extends Error {
  constructor() {
    super('Purchase cancelled');
  }
}

let configured: Promise<PurchasesModule | null> | null = null;

/** Loads and configures RevenueCat once. Returns null when this build has no store key. */
function store(): Promise<PurchasesModule | null> {
  configured ??= (async () => {
    const apiKey = Platform.OS === 'ios' ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;
    if (!apiKey || USE_MOCK_STORE) return null;
    // Loaded lazily so Expo Go and tests never touch the native module.
    const Purchases = (await import('react-native-purchases')).default;
    Purchases.configure({ apiKey });
    return Purchases;
  })();
  return configured;
}

/** Localized store price for the Full plan, e.g. "$6.99" or "฿249.00"; null if unknown. */
export async function fullPlanPrice(): Promise<string | null> {
  try {
    const Purchases = await store();
    if (!Purchases) return null;
    const [product] = await Purchases.getProducts([PRO_PRODUCT_ID]);
    return product?.priceString ?? null;
  } catch {
    return null;
  }
}

export async function purchase(
  api: ApiClient,
  input: { billingCustomerId: string; productId: string },
): Promise<void> {
  if (USE_MOCK_STORE) {
    // Development/test only: the API's mock store simulates a sandbox purchase.
    await api.request('POST', '/v1/dev/mock-store/purchase', {
      body: {
        productId: input.productId,
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
    });
    return;
  }
  const Purchases = await store();
  if (!Purchases) throw new Error('In-app purchases are not available in this build.');
  await Purchases.logIn(input.billingCustomerId);
  const [product] = await Purchases.getProducts([input.productId]);
  if (!product) throw new Error('This plan is not available in your store right now.');
  try {
    await Purchases.purchaseStoreProduct(product);
  } catch (e) {
    if ((e as { userCancelled?: boolean }).userCancelled) throw new PurchaseCancelledError();
    throw e;
  }
}

/** Where a parent manages or cancels the subscription on this platform. */
export function manageSubscriptionUrl(): string {
  return Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : `https://play.google.com/store/account/subscriptions?sku=${encodeURIComponent(PRO_PRODUCT_ID)}&package=th.in.mathchallenge.app`;
}
