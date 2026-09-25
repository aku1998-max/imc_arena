import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Loads the nearest .env file (development convenience only; never required in production). */
export function loadDotEnv(start = process.cwd()): void {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
