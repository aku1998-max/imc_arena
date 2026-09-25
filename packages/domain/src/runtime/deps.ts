import { createPool } from '@imc/db';
import { resolve } from 'node:path';
import { MockAuthAdmin, SupabaseAuthAdmin } from '../adapters/auth-admin.js';
import { LogEmail } from '../adapters/email.js';
import { LocalStorage } from '../adapters/local-storage.js';
import { MockBilling } from '../adapters/mock-billing.js';
import { RevenueCatBilling } from '../adapters/revenuecat-billing.js';
import { SupabaseStorage } from '../adapters/supabase-storage.js';
import type { Deps, Logger } from '../ports.js';
import type { Config } from './config.js';

/** Wires adapters from validated configuration. Mock adapters are refused in production by config. */
export function buildDeps(config: Config, log: Logger, poolSize = 10): Deps {
  const pool = createPool(config.DATABASE_URL, poolSize);
  const storage =
    config.STORAGE_DRIVER === 'local'
      ? new LocalStorage(
          resolve(config.STORAGE_LOCAL_DIR),
          config.STORAGE_SERVER_CREDENTIAL,
          config.API_BASE_URL,
        )
      : new SupabaseStorage(
          config.SUPABASE_URL,
          config.STORAGE_SERVER_CREDENTIAL,
          config.STORAGE_BUCKET,
        );
  const billing =
    config.BILLING_DRIVER === 'mock'
      ? new MockBilling(config.BILLING_WEBHOOK_SECRET)
      : new RevenueCatBilling(
          config.REVENUECAT_API_KEY,
          config.BILLING_WEBHOOK_SECRET,
          config.BILLING_PRODUCT_IDS,
        );
  const authAdmin =
    config.STORAGE_DRIVER === 'supabase' && config.SUPABASE_URL
      ? new SupabaseAuthAdmin(config.SUPABASE_URL, config.STORAGE_SERVER_CREDENTIAL)
      : new MockAuthAdmin(log);
  return { pool, storage, billing, email: new LogEmail(log), authAdmin, log };
}
