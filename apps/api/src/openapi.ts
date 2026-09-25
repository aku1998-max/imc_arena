import { errorEnvelopeSchema } from '@imc/contracts';
import { z } from 'zod';
import type { AnyRoute } from './http.js';

const toSchema = (s: z.ZodType, io: 'input' | 'output') =>
  z.toJSONSchema(s, { io, unrepresentable: 'any', target: 'openapi-3.0' }) as Record<
    string,
    unknown
  >;

/** Builds an OpenAPI 3.0 document from the same zod schemas that validate requests/responses. */
export function buildOpenApi(routes: AnyRoute[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const path = r.url.replace(/:([A-Za-z]+)/g, '{$1}');
    const parameters: unknown[] = [];
    if (r.params) {
      const js = toSchema(r.params, 'input') as { properties?: Record<string, unknown> };
      for (const [name, schema] of Object.entries(js.properties ?? {})) {
        parameters.push({ name, in: 'path', required: true, schema });
      }
    }
    if (r.query) {
      const js = toSchema(r.query, 'input') as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      for (const [name, schema] of Object.entries(js.properties ?? {})) {
        parameters.push({
          name,
          in: 'query',
          required: js.required?.includes(name) ?? false,
          schema,
        });
      }
    }
    if (r.idempotency) {
      parameters.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: r.idempotency === 'required',
        schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,128}$' },
      });
    }
    for (const h of r.requestHeaders ?? []) {
      parameters.push({
        name: h,
        in: 'header',
        required: true,
        description: 'Single-use adult action grant from POST /v1/adult-grants',
        schema: { type: 'string' },
      });
    }
    const status = String(r.successStatus ?? 200);
    const security =
      r.auth === 'none'
        ? []
        : r.auth === 'child'
          ? [{ childToken: [] }]
          : r.auth === 'childOrAdult'
            ? [{ childToken: [] }, { adultJwt: [] }]
            : [{ adultJwt: [] }];
    paths[path] ??= {};
    paths[path]![r.method.toLowerCase()] = {
      summary: r.summary,
      tags: r.tags,
      security,
      parameters,
      ...(r.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: toSchema(r.body, 'input') } },
            },
          }
        : {}),
      responses: {
        [status]:
          status === '204'
            ? { description: 'No content' }
            : {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['data', 'requestId'],
                      properties: {
                        data: r.response ? toSchema(r.response, 'output') : {},
                        requestId: { type: 'string' },
                      },
                    },
                  },
                },
              },
        default: {
          description: 'Error envelope (400, 401, 403, 404, 409, 429, 503)',
          content: { 'application/json': { schema: toSchema(errorEnvelopeSchema, 'output') } },
        },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'IMC Arena API',
      version: '1.0.0',
      description:
        'REST JSON API for the IMC Arena V1 student app, parent area and staff website. Times are ISO 8601 UTC; identifiers are UUIDs. Generated from the route schemas (pnpm openapi).',
    },
    servers: [{ url: 'http://localhost:3000' }],
    components: {
      securitySchemes: {
        adultJwt: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Verified Supabase Auth access token (adults and staff)',
        },
        childToken: {
          type: 'http',
          scheme: 'bearer',
          description: 'Opaque child-mode token issued by POST /v1/students/{id}/child-sessions',
        },
      },
    },
    paths,
  };
}
