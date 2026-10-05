import { defineConfig } from '@playwright/test';

/**
 * Browser tests (npm run test:e2e). They run against the production build with a fresh demo
 * database, so run `npm run build` first. PLAYWRIGHT_CHROMIUM lets CI or a container point to
 * an already installed Chromium instead of downloading one.
 */
const PORT = Number(process.env.E2E_PORT || 3990);

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'ar',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
  },
  webServer: process.env.E2E_EXTERNAL_SERVER === 'true' ? undefined : {
    command: 'node tests/e2e/server.mjs',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_PORT: String(PORT) },
  },
});
