import { createPool } from '@imc/db';
import {
  LocalStorage,
  LogEmail,
  MockAuthAdmin,
  MockBilling,
  RevenueCatBilling,
  SupabaseAuthAdmin,
  SupabaseStorage,
  type Deps,
  type Logger,
} from '@imc/domain';
import { resolve } from 'node:path';
import type { Config } from './config.js';

export function buildDeps(config: Config, log: Logger): Deps {
  const pool = createPool(config.DATABASE_URL);
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
