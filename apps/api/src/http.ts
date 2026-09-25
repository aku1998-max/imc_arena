import { ops, pgErrorCode, isRetryableTxError, type Tx, withTx } from '@imc/db';
import { canonicalJson, DomainError, productDefaults, sha256Hex, type Deps } from '@imc/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { toContext, type AuthMode, type Authenticator, type Principal } from './auth.js';
import type { Config } from './config.js';
import { RateLimiter } from './rate-limit.js';

export interface RouteContext<P, Q, B> {
  req: FastifyRequest;
  reply: FastifyReply;
  principal: Principal | null;
  params: P;
  query: Q;
  body: B;
  deps: Deps;
  config: Config;
  /** Present when the route runs in a framework-managed principal transaction. */
  tx: Tx;
  header(name: string): string | undefined;
}

export interface RouteDef<P = unknown, Q = unknown, B = unknown, R = unknown> {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  auth: AuthMode;
  summary: string;
  tags: string[];
  params?: z.ZodType<P>;
  query?: z.ZodType<Q>;
  body?: z.ZodType<B>;
  response?: z.ZodType<R>;
  successStatus?: number;
  /** Idempotency-Key handling. Required keys are rejected when missing. */
  idempotency?: 'required' | 'optional';
  /** Per-principal (or IP) fixed-window limit. */
  rateLimit?: { max: number; windowSeconds: number };
  /** Set false for routes that manage their own transactions (e.g. provider calls). */
  transaction?: boolean;
  /** Extra response headers documented in OpenAPI (e.g. X-Adult-Grant request header). */
  requestHeaders?: string[];
  handler: (ctx: RouteContext<P, Q, B>) => Promise<R | { status: number; data: R }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRoute = RouteDef<any, any, any, any>;

export function route<P, Q, B, R>(def: RouteDef<P, Q, B, R>): RouteDef<P, Q, B, R> {
  return def;
}

function isStatusWrapped<R>(v: unknown): v is { status: number; data: R } {
  return (
    typeof v === 'object' &&
    v !== null &&
    'status' in v &&
    'data' in v &&
    Object.keys(v).length === 2
  );
}

export function sendError(reply: FastifyReply, req: FastifyRequest, err: unknown, log = true) {
  if (err instanceof DomainError) {
    if (
      err.code === 'RATE_LIMITED' &&
      err.details &&
      typeof err.details === 'object' &&
      'retryAfter' in err.details
    ) {
      reply.header('retry-after', String((err.details as { retryAfter: number }).retryAfter));
    }
    return reply.status(err.status).send({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined && err.code === 'VALIDATION_FAILED'
          ? { details: err.details }
          : {}),
      },
      requestId: req.id,
    });
  }
  if (err instanceof z.ZodError) {
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The request is invalid.',
        // Paths and messages only; never echo submitted values.
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      requestId: req.id,
    });
  }
  const code = pgErrorCode(err);
  if (code === '42501') {
    return reply.status(403).send({
      error: { code: 'FORBIDDEN', message: 'This action is not allowed.' },
      requestId: req.id,
    });
  }
  if (code === 'P0002') {
    return reply
      .status(404)
      .send({ error: { code: 'NOT_FOUND', message: 'Resource not found.' }, requestId: req.id });
  }
  if (code === '23505') {
    return reply.status(409).send({
      error: { code: 'CONFLICT', message: 'This conflicts with existing data.' },
      requestId: req.id,
    });
  }
  if (log) req.log.error({ err: redactError(err) }, 'unhandled error');
  return reply.status(500).send({
    error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' },
    requestId: req.id,
  });
}

function redactError(err: unknown) {
  if (!(err instanceof Error)) return { message: String(err) };
  return { name: err.name, message: err.message, code: pgErrorCode(err), stack: err.stack };
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

export function registerRoutes(
  app: FastifyInstance,
  routes: AnyRoute[],
  env: { deps: Deps; config: Config; auth: Authenticator; limiter: RateLimiter },
) {
  for (const def of routes) {
    app.route({
      method: def.method,
      url: def.url,
      handler: async (req, reply) => {
        try {
          const principal = await env.auth.authenticate(req.headers.authorization, def.auth);
          if (def.rateLimit) {
            const who =
              principal?.type === 'child'
                ? principal.studentId
                : principal
                  ? principal.accountId
                  : req.ip;
            const retryAfter = env.limiter.hit(`${def.method} ${def.url}:${who}`, def.rateLimit);
            if (retryAfter !== null) {
              throw new DomainError('RATE_LIMITED', 'Too many requests. Please slow down.', {
                retryAfter,
              });
            }
          }
          const params = def.params ? def.params.parse(req.params) : undefined;
          const query = def.query ? def.query.parse(req.query) : undefined;
          const body = def.body ? def.body.parse(req.body ?? {}) : undefined;
          const key = req.headers['idempotency-key'];
          const idemKey = typeof key === 'string' ? key : undefined;
          if (def.idempotency === 'required' && !idemKey) {
            throw new DomainError(
              'IDEMPOTENCY_KEY_REQUIRED',
              'An Idempotency-Key header is required.',
            );
          }
          if (idemKey !== undefined && !IDEMPOTENCY_KEY.test(idemKey)) {
            throw new DomainError('VALIDATION_FAILED', 'Invalid Idempotency-Key header.');
          }
          const header = (name: string) => {
            const v = req.headers[name.toLowerCase()];
            return typeof v === 'string' ? v : undefined;
          };

          const run = async (tx: Tx | undefined) => {
            const result = await def.handler({
              req,
              reply,
              principal,
              params,
              query,
              body,
              deps: env.deps,
              config: env.config,
              tx: tx as Tx,
              header,
            });
            const status = isStatusWrapped(result) ? result.status : (def.successStatus ?? 200);
            const raw = isStatusWrapped(result) ? result.data : result;
            // Response contracts are enforced: unknown keys are stripped, strict DTOs reject leaks.
            const data = def.response ? def.response.parse(raw) : raw;
            return { status, data };
          };

          let out: { status: number; data: unknown };
          if (def.transaction === false || !principal) {
            out = await run(undefined);
          } else {
            const principalId =
              principal.type === 'child' ? principal.studentId : principal.accountId;
            const routeKey = `${def.method} ${def.url}`;
            out = await withRetry(() =>
              withTx(env.deps.pool, toContext(principal), async (tx) => {
                if (def.idempotency && idemKey) {
                  const requestHash = sha256Hex(canonicalJson({ params, body }));
                  const claim = await ops.claimIdempotencyKey(tx, {
                    principalId,
                    route: routeKey,
                    key: idemKey,
                    requestHash,
                    ttlHours: productDefaults.idempotencyHours,
                  });
                  if (claim.kind === 'mismatch') {
                    throw new DomainError(
                      'IDEMPOTENCY_CONFLICT',
                      'This Idempotency-Key was used with a different request.',
                    );
                  }
                  if (claim.kind === 'replay') {
                    reply.header('idempotent-replay', 'true');
                    return { status: claim.statusCode, data: claim.response };
                  }
                  const result = await run(tx);
                  await ops.storeIdempotentResponse(tx, {
                    principalId,
                    route: routeKey,
                    key: idemKey,
                    statusCode: result.status,
                    response: result.data,
                  });
                  return result;
                }
                return run(tx);
              }),
            );
          }
          if (out.status === 204) return reply.status(204).send();
          return reply.status(out.status).send({ data: out.data, requestId: req.id });
        } catch (err) {
          return sendError(reply, req, err);
        }
      },
    });
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isRetryableTxError(err)) throw err;
    }
  }
}
