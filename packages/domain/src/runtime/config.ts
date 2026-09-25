import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    ENVIRONMENT: z.enum(['development', 'test', 'staging', 'production']),
    PORT: z.coerce.number().int().default(3000),
    API_BASE_URL: z.url(),
    DATABASE_URL: z.string().min(1),
    AUTH_ISSUER: z.string().min(1),
    AUTH_AUDIENCE: z.string().min(1),
    AUTH_JWKS_URL: z.string().optional().default(''),
    AUTH_JWT_SECRET: z.string().optional().default(''),
    STAFF_REQUIRE_MFA: bool,
    SUPABASE_URL: z.string().optional().default(''),
    STORAGE_DRIVER: z.enum(['local', 'supabase']),
    STORAGE_BUCKET: z.string().default('imc-private'),
    STORAGE_SERVER_CREDENTIAL: z.string().min(16),
    STORAGE_LOCAL_DIR: z.string().default('.var/storage'),
    BILLING_DRIVER: z.enum(['mock', 'revenuecat']),
    BILLING_WEBHOOK_SECRET: z.string().min(16),
    REVENUECAT_API_KEY: z.string().optional().default(''),
    BILLING_PRODUCT_IDS: z
      .string()
      .default('')
      .transform((s) =>
        s
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    EMAIL_DRIVER: z.enum(['log']).default('log'),
    EMAIL_PROVIDER_KEY: z.string().optional().default(''),
    ALLOWED_ADMIN_ORIGINS: z
      .string()
      .default('')
      .transform((s) =>
        s
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().min(10).default(600),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((c, ctx) => {
    if (!c.AUTH_JWKS_URL && !c.AUTH_JWT_SECRET) {
      ctx.addIssue({ code: 'custom', message: 'Set AUTH_JWKS_URL or AUTH_JWT_SECRET' });
    }
    if (c.AUTH_JWT_SECRET && c.AUTH_JWT_SECRET.length < 32) {
      ctx.addIssue({ code: 'custom', message: 'AUTH_JWT_SECRET must be at least 32 characters' });
    }
    const hosted = c.ENVIRONMENT === 'staging' || c.ENVIRONMENT === 'production';
    if (c.ENVIRONMENT === 'production') {
      if (c.STORAGE_DRIVER === 'local')
        ctx.addIssue({
          code: 'custom',
          message: 'local storage mock is not allowed in production',
        });
      if (c.BILLING_DRIVER === 'mock')
        ctx.addIssue({ code: 'custom', message: 'mock billing is not allowed in production' });
      if (!c.AUTH_JWKS_URL)
        ctx.addIssue({
          code: 'custom',
          message: 'production requires AUTH_JWKS_URL (asymmetric keys)',
        });
      if (!c.API_BASE_URL.startsWith('https://'))
        ctx.addIssue({ code: 'custom', message: 'production API_BASE_URL must be https' });
    }
    if (hosted && c.STORAGE_DRIVER === 'supabase' && !c.SUPABASE_URL) {
      ctx.addIssue({ code: 'custom', message: 'SUPABASE_URL is required for supabase storage' });
    }
    if (c.BILLING_DRIVER === 'revenuecat' && !c.REVENUECAT_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        message: 'REVENUECAT_API_KEY is required for revenuecat billing',
      });
    }
    if (/postgres(ql)?:\/\/(postgres|imc_owner)[:@]/.test(c.DATABASE_URL)) {
      ctx.addIssue({
        code: 'custom',
        message: 'DATABASE_URL must use the runtime role, not an owner/superuser',
      });
    }
  });

export type Config = z.infer<typeof schema> & { staffRequireMfa: boolean };

/** Validates configuration at startup; fails fast with the list of problems (never values). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (i) => `${i.path.join('.') || 'config'}: ${i.message}`,
    );
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  const c = parsed.data;
  return { ...c, staffRequireMfa: c.ENVIRONMENT === 'production' || c.STAFF_REQUIRE_MFA };
}
