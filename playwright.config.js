// @ts-check
import { defineConfig, devices } from '@playwright/test';
import { loadLocalEnv } from './scripts/load-env.mjs';

loadLocalEnv();

const PORT = 5173;
const IS_STAGING = process.env.STAGING_E2E === '1';
const STAGING_SPEC_FILES = [
  '**/postgres-only-cutover.spec.js',
  '**/quotation-cutover-staging.spec.js',
];

function parseOrigin(value, label) {
  let parsed;
  try {
    parsed = new globalThis.URL(String(value || '').trim());
  } catch {
    throw new Error(`${label} must be a valid HTTP(S) origin without credentials`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${label} must be a valid HTTP(S) origin without credentials`);
  }
  return parsed.origin;
}

function resolveBaseUrl() {
  if (!IS_STAGING) return process.env.BASE_URL || process.env.STAGING_BASE_URL || `http://localhost:${PORT}`;
  const stagingOrigin = parseOrigin(process.env.STAGING_BASE_URL, 'STAGING_BASE_URL');
  const configuredBaseOrigin = parseOrigin(process.env.BASE_URL || stagingOrigin, 'BASE_URL');
  if (configuredBaseOrigin !== stagingOrigin) {
    throw new Error('BASE_URL must match STAGING_BASE_URL during staging E2E');
  }
  return stagingOrigin;
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
        testIgnore: STAGING_SPEC_FILES,
        webServer: {
          command: 'npx vite --port 5173',
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 20_000,
          cwd: '.',
        },
      }),
});
