import { SignJWT } from 'jose';

/**
 * Mints an HS256 adult JWT shaped like a Supabase Auth access token. For local development and
 * automated tests only; the API rejects HS256 in production (it requires AUTH_JWKS_URL).
 */
export async function mintAdultJwt(input: {
  secret: string;
  issuer: string;
  audience: string;
  sub: string;
  email?: string;
  /** Seconds since the OTP was verified; null omits the amr claim entirely. */
  otpAgeSeconds?: number | null;
  aal?: 'aal1' | 'aal2';
  expiresInSeconds?: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const age = input.otpAgeSeconds === undefined ? 10 : input.otpAgeSeconds;
  const claims: Record<string, unknown> = {
    email: input.email ?? `${input.sub.slice(0, 8)}@example.test`,
    role: 'authenticated',
    aal: input.aal ?? 'aal1',
  };
  if (age !== null) claims.amr = [{ method: 'otp', timestamp: now - age }];
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(input.sub)
    .setIssuer(input.issuer)
    .setAudience(input.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + (input.expiresInSeconds ?? 3600))
    .sign(new TextEncoder().encode(input.secret));
}
