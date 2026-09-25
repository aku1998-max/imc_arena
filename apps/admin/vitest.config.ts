import { defineConfig } from 'vitest/config';

// Browser flows live in e2e/ and run with Playwright (pnpm --filter @imc/admin e2e).
export default defineConfig({ test: { include: ['src/**/*.test.{ts,tsx}'] } });
