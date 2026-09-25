import { loadDotEnv } from '@imc/db';
import { consoleLogger } from '@imc/domain';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { buildDeps } from './deps.js';

loadDotEnv();
const config = loadConfig();
const deps = buildDeps(config, consoleLogger);
const app = await buildApp(config, deps);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await deps.pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: '0.0.0.0' });
