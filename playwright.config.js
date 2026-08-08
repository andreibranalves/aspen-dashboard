// @ts-check
import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;
const IS_STAGING = process.env.STAGING_E2E === '1';

function resolveBaseUrl() {
  const raw = process.env.BASE_URL || process.env.STAGING_BASE_URL || `http://localhost:${PORT}`;
  if (!IS_STAGING) return raw;
  let parsed;
  try {
    parsed = new globalThis.URL(raw);
  } catch {
    throw new Error('STAGING_BASE_URL must be a valid HTTP(S) origin without credentials');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('STAGING_BASE_URL must be a valid HTTP(S) origin without credentials');
  }
  return parsed.origin;
}

const BASE_URL = resolveBaseUrl();

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: !IS_STAGING,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: IS_STAGING ? 1 : 2,
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
