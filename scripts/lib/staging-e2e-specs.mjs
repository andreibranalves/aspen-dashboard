// Fonte única da suíte controlada de staging E2E.
//
// Consumidores:
// - playwright.config.js  → modo Preview seleciona SOMENTE estes specs;
//   modo local os ignora explicitamente (modos mutuamente exclusivos).
// - scripts/run-staging-e2e.mjs → roda exatamente esta lista (sem drift com o config).
//
// Qualquer spec novo que deva rodar contra staging precisa entrar aqui,
// junto do gate de identidade remota em tests/support/staging-auth.js.
export const STAGING_E2E_SPECS = Object.freeze([
  'tests/postgres-only-cutover.spec.js',
  'tests/quotation-cutover-staging.spec.js',
]);
