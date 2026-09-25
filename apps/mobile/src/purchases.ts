import type { ApiClient } from './lib/api-client';

/**
 * Store purchase adapter. Access is granted only after the backend verifies provider state; the
 * store's success callback alone never unlocks Pro.
 *
 * V1 pilot builds ship without the native store SDK. At the paid gate, replace `nativeStorePurchase`
 * with RevenueCat (react-native-purchases) configured with appUserID = billingCustomerId, then call
 * POST /v1/billing/restore. See docs/runbooks/paid-gate.md.
 */
export async function purchase(
  api: ApiClient,
  input: { billingCustomerId: string; productId: string },
): Promise<void> {
  if (__DEV__) {
    // Development/test only: the API's mock store simulates a sandbox purchase.
    await api.request('POST', '/v1/dev/mock-store/purchase', {
      body: {
        productId: input.productId,
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
    });
    return;
  }
  await nativeStorePurchase(input);
}

async function nativeStorePurchase(_input: {
  billingCustomerId: string;
  productId: string;
}): Promise<void> {
  throw new Error('In-app purchases are not available in this build yet.');
}
