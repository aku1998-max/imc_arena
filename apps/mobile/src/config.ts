export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
/** Development-only: paste a token minted by `pnpm --filter @imc/api dev:token parent`. */
export const DEV_AUTH = process.env.EXPO_PUBLIC_DEV_AUTH === 'true' && __DEV__;
export const CONSENT_POLICY_VERSION = '2026-09-pilot';
export const SUPPORT_URL = 'https://example.org/imc-arena/help';
