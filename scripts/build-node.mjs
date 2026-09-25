// Bundles a Node service: workspace packages (@imc/*, shipped as TypeScript source) are
// compiled in; third-party npm packages stay external and are installed in the runtime image.
import { build } from 'esbuild';

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error('usage: node scripts/build-node.mjs <entry.ts> <outfile.js>');
  process.exit(1);
}

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  plugins: [
    {
      name: 'externalize-npm',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith('@imc/') ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
  logLevel: 'info',
});
