// Fonte única da suíte controlada de Preview E2E.
//
// Consumidores:
// - playwright.config.js  → modo Preview seleciona SOMENTE estes specs;
//   modo local os ignora explicitamente (modos mutuamente exclusivos).
// - scripts/run-preview-e2e.mjs → roda exatamente esta lista (sem drift com o config).
//
// Qualquer spec novo que deva rodar contra Preview precisa entrar aqui,
// junto do gate de identidade remota em tests/support/preview-auth.js.
export const PREVIEW_E2E_SPECS = Object.freeze([
  'tests/postgres-only-cutover.spec.js',
  'tests/quotation-cutover-preview.spec.js',
]);
