// @ts-check
import { defineConfig, devices } from '@playwright/test';
import { loadLocalEnv } from './scripts/load-env.mjs';
import { STAGING_E2E_SPECS } from './scripts/lib/staging-e2e-specs.mjs';
import { isStagingMode, resolveE2eBaseUrl } from './scripts/lib/e2e-mode.mjs';

loadLocalEnv();

const PORT = Number(process.env.PLAYWRIGHT_PORT || 5173);
// Modos mutuamente exclusivos (fonte única: scripts/lib/e2e-mode.mjs).
// Configurações contraditórias falham no carregamento deste arquivo —
// antes do primeiro request HTTP de qualquer suite.
const IS_STAGING = isStagingMode();
const BASE_URL = resolveE2eBaseUrl(process.env, { port: PORT });
process.env.BASE_URL = BASE_URL;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: !IS_STAGING,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Database-backed local specs share one disposable schema and must not migrate it concurrently.
  workers: IS_STAGING || process.env.TEST_DATABASE_URL ? 1 : 2,
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

  // Seleção mutuamente exclusiva definida pela fonte única
  // scripts/lib/staging-e2e-specs.mjs:
  // - Preview roda SOMENTE a suíte controlada de staging contra STAGING_BASE_URL.
  // - Modo local nunca seleciona specs de staging (mesmo por filtros explícitos).
  ...(IS_STAGING
    ? { testMatch: [...STAGING_E2E_SPECS] }
    : {
        testIgnore: [...STAGING_E2E_SPECS],
        webServer: {
          command: 'node scripts/vite-dev.mjs',
          url: BASE_URL,
          // Own isolated stack: never reuse another worktree's Vite/API ports.
          reuseExistingServer: false,
          // Covers a clean-checkout API compilation (~5s) plus normal startup.
          timeout: 60_000,
          cwd: '.',
          env: {
            NODE_ENV: 'test',
            APP_AUTH_BYPASS: 'true',
            API_PORT: '0',
            PORT: String(PORT),
          },
        },
      }),
});
