import { loadDotEnv } from '@imc/db';
import { mintAdultJwt } from '@imc/testing';

export const STAFF = {
  editor: '00000000-0000-4000-8000-0000000e2e01',
  reviewer: '00000000-0000-4000-8000-0000000e2e02',
  administrator: '00000000-0000-4000-8000-0000000e2e03',
} as const;

export async function tokenFor(role: keyof typeof STAFF) {
  loadDotEnv();
  return mintAdultJwt({
    secret: process.env.AUTH_JWT_SECRET!,
    issuer: process.env.AUTH_ISSUER!,
    audience: process.env.AUTH_AUDIENCE!,
    sub: STAFF[role],
  });
}
