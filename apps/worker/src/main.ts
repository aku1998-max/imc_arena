import { loadDotEnv } from '@imc/db';
import { buildDeps, consoleLogger, loadConfig } from '@imc/domain';
import { Worker } from './worker.js';

loadDotEnv();
const config = loadConfig();
const deps = buildDeps(config, consoleLogger, 4);
const worker = new Worker(deps, {
  pollMs: Number(process.env.WORKER_POLL_MS ?? 2000),
  scheduleEveryMs: 5 * 60_000,
  batchSize: 10,
});

const shutdown = (signal: string) => {
  consoleLogger.info({ signal }, 'worker stopping after the current batch');
  worker.stop();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

consoleLogger.info({ environment: config.ENVIRONMENT }, 'worker started');
await worker.run();
await deps.pool.end();
