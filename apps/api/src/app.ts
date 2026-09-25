import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Deps } from '@imc/domain';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Authenticator } from './auth.js';
import type { Config } from '@imc/domain';
import { registerRoutes, sendError, type AnyRoute } from './http.js';
import { RateLimiter } from './rate-limit.js';
import { adminRoutes } from './routes/admin.js';
import { parentRoutes } from './routes/parent.js';
import { registerDevRoutes, systemRoutes } from './routes/system.js';
import { studentRoutes } from './routes/student.js';

export const allRoutes: AnyRoute[] = [
  ...systemRoutes,
  ...studentRoutes,
  ...parentRoutes,
  ...adminRoutes,
];

export async function buildApp(config: Config, deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.LOG_LEVEL === 'silent'
        ? false
        : {
            level: config.LOG_LEVEL,
            // Never log bearer tokens, grants, OTPs, cookies or request bodies.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers["x-adult-grant"]',
                'req.headers.cookie',
                'req.query.sig',
              ],
              censor: '[redacted]',
            },
            serializers: {
              req: (req) => ({ id: req.id, method: req.method, url: req.url.split('?')[0] }),
            },
          },
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(incoming)
        ? incoming
        : randomUUID();
    },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: config.ENVIRONMENT === 'staging' || config.ENVIRONMENT === 'production',
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cors, {
    // Only the staff website is a browser client; native apps do not need CORS.
    origin: config.ALLOWED_ADMIN_ORIGINS,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: [
      'authorization',
      'content-type',
      'idempotency-key',
      'x-adult-grant',
      'x-request-id',
    ],
    exposedHeaders: ['x-request-id', 'retry-after'],
  });
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_GLOBAL_MAX,
    timeWindow: '1 minute',
    errorResponseBuilder: (req, ctx) => ({
      statusCode: 429,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
      requestId: req.id,
      retryAfter: Math.ceil(ctx.ttl / 1000),
    }),
  });

  app.setNotFoundHandler((req, reply) =>
    reply
      .status(404)
      .send({ error: { code: 'NOT_FOUND', message: 'Route not found.' }, requestId: req.id }),
  );
  app.setErrorHandler((err, req, reply) => {
    const e = err as { statusCode?: number; code?: string };
    if (e.statusCode === 429) return reply.status(429).send(err);
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode === 413 ? 413 : 400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: e.statusCode === 413 ? 'Request too large.' : 'The request is invalid.',
        },
        requestId: req.id,
      });
    }
    return sendError(reply, req, err);
  });

  const auth = new Authenticator(config, deps);
  registerRoutes(app, allRoutes, { deps, config, auth, limiter: new RateLimiter() });
  registerDevRoutes(app, deps, config, auth);
  return app;
}
