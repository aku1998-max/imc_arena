import type { PrincipalContext } from '@imc/db';
import { accounts, withTx } from '@imc/db';
import { accountsService, DomainError, identity, type Deps } from '@imc/domain';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Config } from '@imc/domain';

export type AuthMode = 'none' | 'child' | 'adult' | 'staff' | 'childOrAdult';

export interface AdultClaims {
  sub: string;
  email: string | null;
  aal: string | null;
  /** Unix seconds of the most recent OTP/magic-link verification, if the token carries it. */
  otpVerifiedAt: number | null;
}

export type Principal =
  | { type: 'child'; studentId: string; childSessionId: string }
  | { type: 'adult'; accountId: string; claims: AdultClaims }
  | { type: 'staff'; accountId: string; roles: string[]; claims: AdultClaims };

export function toContext(p: Principal): PrincipalContext {
  if (p.type === 'child')
    return { type: 'child', studentId: p.studentId, childSessionId: p.childSessionId };
  return { type: p.type, accountId: p.accountId };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class Authenticator {
  private readonly key: Parameters<typeof jwtVerify>[1];
  private readonly algorithms: string[];

  constructor(
    private readonly config: Config,
    private readonly deps: Deps,
  ) {
    if (config.AUTH_JWKS_URL) {
      this.key = createRemoteJWKSet(new URL(config.AUTH_JWKS_URL));
      this.algorithms = ['RS256', 'ES256', 'EdDSA'];
    } else {
      this.key = new TextEncoder().encode(config.AUTH_JWT_SECRET);
      this.algorithms = ['HS256'];
    }
  }

  /** Verifies signature, issuer, audience and expiry. A decoded-but-unverified JWT is never trusted. */
  async verifyAdultJwt(token: string): Promise<AdultClaims> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.key, {
        issuer: this.config.AUTH_ISSUER,
        audience: this.config.AUTH_AUDIENCE,
        algorithms: this.algorithms,
        requiredClaims: ['sub', 'exp'],
        clockTolerance: 5,
      }));
    } catch {
      throw new DomainError('UNAUTHENTICATED', 'Please sign in again.');
    }
    if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) {
      throw new DomainError('UNAUTHENTICATED', 'Please sign in again.');
    }
    const amr = Array.isArray(payload.amr)
      ? (payload.amr as Array<{ method?: string; timestamp?: number }>)
      : [];
    const otp = amr
      .filter(
        (a) =>
          a && (a.method === 'otp' || a.method === 'magiclink') && typeof a.timestamp === 'number',
      )
      .map((a) => a.timestamp!)
      .sort((a, b) => b - a)[0];
    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      aal: typeof payload.aal === 'string' ? payload.aal : null,
      otpVerifiedAt: otp ?? null,
    };
  }

  async authenticate(authorization: string | undefined, mode: AuthMode): Promise<Principal | null> {
    if (mode === 'none') return null;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : undefined;
    if (!token) throw new DomainError('UNAUTHENTICATED', 'Sign-in required.');
    const isJwt = token.split('.').length === 3;

    if (!isJwt) {
      const session = await identity.authenticateChildToken(this.deps.pool, token);
      if (!session)
        throw new DomainError('UNAUTHENTICATED', 'Child session expired. Ask a parent to sign in.');
      if (mode !== 'child' && mode !== 'childOrAdult') {
        throw new DomainError('FORBIDDEN', 'This action is not available in child mode.');
      }
      return { type: 'child', studentId: session.studentId, childSessionId: session.sessionId };
    }

    if (mode === 'child')
      throw new DomainError('FORBIDDEN', 'This action is only available in child mode.');
    const claims = await this.verifyAdultJwt(token);

    if (mode === 'staff') {
      if (this.config.staffRequireMfa && claims.aal !== 'aal2') {
        throw new DomainError('FORBIDDEN', 'Staff access requires multi-factor authentication.');
      }
      const roles = await withTx(
        this.deps.pool,
        { type: 'staff', accountId: claims.sub },
        async (tx) => {
          // First verified sign-in creates the account row so an administrator can grant a role.
          const account =
            (await accounts.findAccount(tx, claims.sub)) ??
            (await accounts.ensureAccount(tx, claims.sub, 'en'));
          if (account.status !== 'active') return [];
          return accounts.activeStaffRoles(tx, claims.sub);
        },
      );
      if (roles.length === 0) {
        throw new DomainError(
          'FORBIDDEN',
          `Staff access required. Ask an administrator to grant a role to account ${claims.sub}.`,
        );
      }
      return { type: 'staff', accountId: claims.sub, roles, claims };
    }

    const account = await withTx(
      this.deps.pool,
      { type: 'adult', accountId: claims.sub },
      async (tx) => {
        const existing = await accounts.findAccount(tx, claims.sub);
        if (existing) return existing;
        return accountsService.ensureAdultAccount(tx);
      },
    );
    if (account.status !== 'active') {
      throw new DomainError('FORBIDDEN', 'This account is being closed.');
    }
    return { type: 'adult', accountId: claims.sub, claims };
  }
}

/** True when the adult verified an OTP within the freshness window. */
export function isFreshAdultAuth(
  claims: AdultClaims,
  windowSeconds: number,
  now = Date.now(),
): boolean {
  return claims.otpVerifiedAt !== null && now / 1000 - claims.otpVerifiedAt <= windowSeconds;
}
