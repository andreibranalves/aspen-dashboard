// @ts-check
// Config dedicada da suíte integrada segura. Só scripts/run-safe-e2e.mjs a
// invoca (`npx playwright test --config playwright.safe.config.js`), e ela
// recusa carregar — antes de qualquer spawn de servidor/browser — a menos que
// exista a capability efêmera criada pelo runner para ESTE run, ESTA config e
// ESTAS specs. O playwright.config.js comum nunca chega aqui e sempre exclui
// SAFE_E2E_SPECS.
//
// Não carrega `.env` operacional: o runner já fixou DOTENV_CONFIG_PATH=/dev/null
// e o alvo loopback. O import da capability é síncrono, então uma falha de
// validação derruba o carregamento da config (exit != 0) antes do webServer.
import { defineConfig, devices } from '@playwright/test';
import { assertSafeE2eCapability } from './scripts/lib/safe-e2e-capability.mjs';
import { SAFE_E2E_SPECS, safeE2eEnvironmentIsValid } from './scripts/lib/safe-e2e-env.mjs';
import { isPreviewMode, resolveE2eBaseUrl } from './scripts/lib/e2e-mode.mjs';

if (isPreviewMode()) {
  throw new Error('A config segura do E2E não roda contra um deployment Preview.');
}
if (!safeE2eEnvironmentIsValid(process.env)) {
  throw new Error(
    'A config segura do E2E exige o ambiente isolado do runner. Use `npm run test:e2e:safe`.'
  );
}
assertSafeE2eCapability(process.env);

const PORT = Number(process.env.PLAYWRIGHT_PORT || 5173);
const BASE_URL = resolveE2eBaseUrl(process.env, { port: PORT });
process.env.BASE_URL = BASE_URL;

export default defineConfig({
  testDir: './tests',
  // Fonte única da suíte integrada; nunca uma lista duplicada.
  testMatch: [...SAFE_E2E_SPECS],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Um banco descartável é migrado pelo próprio spec; nunca concorrer.
  workers: 1,
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

  webServer: {
    command: 'node scripts/vite-dev.mjs',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
    cwd: '.',
    env: {
      NODE_ENV: 'test',
      APP_AUTH_BYPASS: 'true',
      API_PORT: '0',
      PORT: String(PORT),
    },
  },
});
