export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
/** Development-only: paste a token minted by `pnpm --filter @imc/api dev:token parent`. */
export const DEV_AUTH = process.env.EXPO_PUBLIC_DEV_AUTH === 'true' && __DEV__;
export const CONSENT_POLICY_VERSION = '2026-09-pilot';
export const SUPPORT_URL =
  process.env.EXPO_PUBLIC_SUPPORT_URL ?? 'https://mathchallenge.in.th/app/support.html';
export const PRIVACY_URL =
  process.env.EXPO_PUBLIC_PRIVACY_URL ?? 'https://mathchallenge.in.th/app/privacy.html';
/** Store product for the Full plan; the price shown comes from the store, never hard-coded. */
export const PRO_PRODUCT_ID = process.env.EXPO_PUBLIC_PRO_PRODUCT_ID ?? 'imc_pro_monthly';
export const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
export const REVENUECAT_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';
