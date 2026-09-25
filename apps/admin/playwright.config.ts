import { defineConfig, devices } from '@playwright/test';

const API_PORT = 3100;
const WEB_PORT = 4173;
const e2eDb = (url: string | undefined, fallback: string) => {
  const u = new URL(url ?? fallback);
  u.pathname = '/imc_arena_e2e';
  return u.toString();
};

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @imc/api exec tsx src/server.ts',
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ENVIRONMENT: 'test',
        PORT: String(API_PORT),
        API_BASE_URL: `http://localhost:${API_PORT}`,
        DATABASE_URL: e2eDb(
          process.env.DATABASE_URL,
          'postgres://imc_api:local-runtime-password@localhost:5432/x',
        ),
        ALLOWED_ADMIN_ORIGINS: `http://localhost:${WEB_PORT}`,
        STORAGE_DRIVER: 'local',
        STORAGE_LOCAL_DIR: '.var/e2e-storage',
        BILLING_DRIVER: 'mock',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        VITE_API_BASE_URL: `http://localhost:${API_PORT}`,
        VITE_DEV_AUTH: 'true',
        VITE_SUPABASE_PUBLISHABLE_KEY: '',
      },
    },
  ],
});
