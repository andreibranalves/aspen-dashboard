// @ts-check
import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
const IS_STAGING = process.env.STAGING_E2E === '1';
const BASE_URL = process.env.BASE_URL || process.env.STAGING_BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],
  timeout: 60000,
  expect: { timeout: 10000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Auto-start Vite only for local suites; staging runs against STAGING_BASE_URL.
  ...(IS_STAGING
    ? {}
    : {
        webServer: {
          command: 'npx vite --port 5173',
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 20_000,
          cwd: '.',
        },
      }),
});
