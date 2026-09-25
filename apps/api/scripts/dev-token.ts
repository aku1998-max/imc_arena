import { loadDotEnv } from '@imc/db';
import { mintAdultJwt } from '@imc/testing';
import { loadConfig } from '../src/config.js';
import { DEV_PARENT, DEV_STAFF } from '../src/seed.js';

/**
 * DEVELOPMENT ONLY: prints an HS256 adult/staff token signed with AUTH_JWT_SECRET, standing in for
 * a Supabase email-OTP sign-in when no local Auth server is running.
 * Usage: pnpm --filter @imc/api dev:token [parent|editor|reviewer|administrator|<uuid>]
 */
loadDotEnv();
const config = loadConfig();
if (config.ENVIRONMENT !== 'development' && config.ENVIRONMENT !== 'test') {
  throw new Error('dev tokens are only available in development/test');
}
if (!config.AUTH_JWT_SECRET) throw new Error('AUTH_JWT_SECRET is not set');
const who = process.argv[2] ?? 'parent';
const sub = who === 'parent' ? DEV_PARENT : ((DEV_STAFF as Record<string, string>)[who] ?? who);
console.log(
  await mintAdultJwt({
    secret: config.AUTH_JWT_SECRET,
    issuer: config.AUTH_ISSUER,
    audience: config.AUTH_AUDIENCE,
    sub,
    aal: config.staffRequireMfa ? 'aal2' : 'aal1',
    expiresInSeconds: 8 * 3600,
  }),
);
