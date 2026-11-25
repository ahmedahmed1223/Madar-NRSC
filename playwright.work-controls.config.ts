import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Keep the focused compatibility matrix separate from the much larger default suite.
export default defineConfig({
  ...base,
  testMatch: '**/work-controls.spec.ts',
  testIgnore: [],
  projects: ['chromium', 'webkit'].flatMap(browserName =>
    [
      { name: 'desktop', viewport: { width: 1440, height: 900 } },
      { name: 'mobile', viewport: { width: 360, height: 800 } },
    ].map(({ name, viewport }) => ({
      name: `${browserName}-${name}`,
      use: {
        browserName: browserName as 'chromium' | 'webkit',
        viewport,
        locale: 'ar-EG',
        timezoneId: 'America/Los_Angeles',
        // A registered offline worker otherwise serves the SPA for the embed host.
        serviceWorkers: 'block',
        // The optional system Chromium path must never be passed to WebKit.
        launchOptions: browserName === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM }
          : {},
      },
    })),
  ),
});
