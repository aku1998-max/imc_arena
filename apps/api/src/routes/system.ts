import { accounts, withTx } from '@imc/db';
import {
  billingService,
  DomainError,
  LocalStorage,
  MockBilling,
  sha256Hex,
  type Deps,
} from '@imc/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Authenticator } from '../auth.js';
import type { Config } from '@imc/domain';
import { route, sendError, type AnyRoute } from '../http.js';

export const systemRoutes: AnyRoute[] = [
  route({
    method: 'GET',
    url: '/health',
    auth: 'none',
    summary: 'Liveness',
    tags: ['system'],
    response: z.object({ status: z.literal('ok') }),
    handler: async () => ({ status: 'ok' as const }),
  }),

  route({
    method: 'GET',
    url: '/ready',
    auth: 'none',
    summary: 'Readiness (database reachable)',
    tags: ['system'],
    response: z.object({ status: z.literal('ready') }),
    handler: async ({ deps }) => {
      try {
        await deps.pool.query('select 1');
      } catch {
        throw new DomainError('SERVICE_UNAVAILABLE', 'Database unavailable.');
      }
      return { status: 'ready' as const };
    },
  }),

  route({
    method: 'POST',
    url: '/webhooks/revenuecat',
    auth: 'none',
    summary: 'Billing provider events: authenticated, deduplicated and durably enqueued',
    tags: ['billing'],
    response: z.object({ received: z.literal(true), duplicate: z.boolean() }),
    transaction: false,
    handler: async ({ req, deps }) => {
      const result = await billingService.ingestWebhook(deps.pool, deps.billing, {
        authorization: req.headers.authorization,
        payload: req.body,
      });
      return { received: true as const, duplicate: result.duplicate };
    },
  }),
];

/**
 * Development-only routes: the local storage mock's signed media endpoints and a simulated
 * store purchase for the mock billing adapter. Never registered in staging/production.
 */
export function registerDevRoutes(
  app: FastifyInstance,
  deps: Deps,
  config: Config,
  auth: Authenticator,
) {
  if (config.ENVIRONMENT !== 'development' && config.ENVIRONMENT !== 'test') return;

  const storage = deps.storage;
  if (storage instanceof LocalStorage) {
    app.addContentTypeParser(
      ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'],
      { parseAs: 'buffer', bodyLimit: 3 * 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );

    app.get<{ Params: { key: string }; Querystring: { exp?: string; sig?: string } }>(
      '/v1/media/local/:key',
      async (req, reply) => {
        const key = decodeURIComponent(req.params.key);
        if (!storage.verify('get', key, Number(req.query.exp), req.query.sig ?? '')) {
          return reply
            .status(403)
            .send({ error: { code: 'FORBIDDEN', message: 'Link expired.' }, requestId: req.id });
        }
        const obj = await storage.read(key);
        if (!obj)
          return reply
            .status(404)
            .send({ error: { code: 'NOT_FOUND', message: 'Not found.' }, requestId: req.id });
        return reply
          .header('content-type', obj.mime)
          .header('cache-control', 'private, max-age=60')
          .header('x-content-type-options', 'nosniff')
          .send(obj.body);
      },
    );

    app.put<{ Params: { key: string }; Querystring: Record<string, string> }>(
      '/v1/media/local-upload/:key',
      async (req, reply) => {
        const key = decodeURIComponent(req.params.key);
        const { exp, sig, mime, size } = req.query;
        const extra = `${mime}\n${size}`;
        if (!storage.verify('put', key, Number(exp), sig ?? '', extra)) {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'Upload link expired.' },
            requestId: req.id,
          });
        }
        const body = req.body as Buffer;
        if (!Buffer.isBuffer(body) || body.length !== Number(size)) {
          return reply.status(400).send({
            error: { code: 'VALIDATION_FAILED', message: 'Size mismatch.' },
            requestId: req.id,
          });
        }
        await storage.put(key, body, mime!);
        return reply
          .status(200)
          .send({ data: { stored: true, sha256: sha256Hex(body) }, requestId: req.id });
      },
    );
  }

  if (deps.billing instanceof MockBilling) {
    const billing = deps.billing;
    const body = z.strictObject({
      productId: z.string().min(1),
      status: z
        .enum(['active', 'trial', 'cancelled', 'grace', 'billing_issue', 'expired', 'refunded'])
        .default('active'),
      expiresAt: z.iso.datetime(),
      originalTransactionId: z.string().min(1).max(200).optional(),
    });
    // Simulates the native store completing a sandbox purchase for the signed-in adult.
    app.post('/v1/dev/mock-store/purchase', async (req, reply) => {
      try {
        const token = req.headers.authorization?.slice(7) ?? '';
        const claims = await auth.verifyAdultJwt(token);
        const parsed = body.parse(req.body);
        const account = await withTx(deps.pool, { type: 'adult', accountId: claims.sub }, (tx) =>
          accounts.findAccount(tx, claims.sub),
        );
        if (!account) throw new DomainError('NOT_FOUND', 'Account not found.');
        const originalTransactionId =
          parsed.originalTransactionId ?? `mock:${parsed.productId}:${Date.now()}`;
        billing.setSubscription(account.billingCustomerId, {
          originalTransactionId,
          productId: parsed.productId,
          status: parsed.status,
          expiresAt: new Date(parsed.expiresAt),
          graceExpiresAt: null,
        });
        return reply.send({ data: { originalTransactionId }, requestId: req.id });
      } catch (err) {
        return sendError(reply, req, err);
      }
    });
  }
}
