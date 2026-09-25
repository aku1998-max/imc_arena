import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { allRoutes } from '../src/app.js';
import { buildOpenApi } from '../src/openapi.js';

it('docs/openapi.json is up to date with the route schemas (run pnpm openapi)', () => {
  const committed = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'docs', 'openapi.json'), 'utf8'),
  );
  expect(committed).toEqual(JSON.parse(JSON.stringify(buildOpenApi(allRoutes))));
});

it('documents every route', () => {
  const doc = buildOpenApi(allRoutes);
  const count = Object.values(doc.paths).reduce((n, p) => n + Object.keys(p).length, 0);
  expect(count).toBe(allRoutes.length);
});
