// @ts-check
import { defineConfig, devices } from '@playwright/test';
import { loadLocalEnv } from './scripts/load-env.mjs';
import { PREVIEW_E2E_SPECS } from './scripts/lib/preview-e2e-specs.mjs';
import { SAFE_E2E_SPECS } from './scripts/lib/safe-e2e-env.mjs';
import { assertSafeE2eCapability } from './scripts/lib/safe-e2e-capability.mjs';
import { isPreviewMode, resolveE2eBaseUrl } from './scripts/lib/e2e-mode.mjs';

loadLocalEnv();

const PORT = Number(process.env.PLAYWRIGHT_PORT || 5173);
// Modos mutuamente exclusivos (fonte única: scripts/lib/e2e-mode.mjs).
// Configurações contraditórias falham no carregamento deste arquivo —
// antes do primeiro request HTTP de qualquer suite.
const IS_PREVIEW = isPreviewMode();
if (IS_PREVIEW) {
  // Reutilizamos a capability interna SAFE_E2E_* já existente para impedir que
  // uma invocação direta importe os specs Preview sem passar pelo runner.
  // Esses nomes não são configuração operacional do usuário.
  assertSafeE2eCapability(process.env, {
    config: 'playwright.config.js',
    specs: PREVIEW_E2E_SPECS,
  });
}
const BASE_URL = resolveE2eBaseUrl(process.env, { port: PORT });
process.env.BASE_URL = BASE_URL;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: !IS_PREVIEW,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Database-backed local specs share one disposable schema and must not migrate it concurrently.
  workers: IS_PREVIEW || process.env.TEST_DATABASE_URL ? 1 : 2,
  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],
  timeout: 60000,
  expect: { timeout: 10000 },

  use: {
    baseURL: BASE_URL,
    trace: IS_PREVIEW ? 'off' : 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Seleção mutuamente exclusiva definida pela fonte única
  // scripts/lib/preview-e2e-specs.mjs:
  // - Preview roda SOMENTE a suíte controlada contra PREVIEW_BASE_URL.
  // - Modo local nunca seleciona specs de Preview (mesmo por filtros explícitos).
  // A suíte integrada (scripts/lib/safe-e2e-env.mjs) é SEMPRE excluída aqui: só
  // `playwright.safe.config.js`, com a capability viva do runner, a descobre.
  // `test:e2e` genérico, `--grep @smoke` e invocações diretas não a importam.
  ...(IS_PREVIEW
    ? { testMatch: [...PREVIEW_E2E_SPECS] }
    : {
        testIgnore: [...PREVIEW_E2E_SPECS, ...SAFE_E2E_SPECS],
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
