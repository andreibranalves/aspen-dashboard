// Referência visual local: compara telas principais com screenshots versionados.
// Fora da suíte padrão porque a renderização de fontes varia entre máquinas.
import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
  ...base,
  testMatch: '**/*.visual.js',
  testIgnore: [],
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/visual/__screenshots__/{arg}{ext}',
  expect: {
    ...base.expect,
    // Tolera só o ruído de antialiasing de fontes (poucos pixels entre execuções).
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixels: 40 },
  },
});
