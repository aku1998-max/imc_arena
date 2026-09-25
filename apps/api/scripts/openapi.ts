import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allRoutes } from '../src/app.js';
import { buildOpenApi } from '../src/openapi.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'openapi.json');
const doc = buildOpenApi(allRoutes);
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`wrote ${out} (${Object.keys(doc.paths).length} paths)`);
