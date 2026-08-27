// Seleção de modo E2E: local vs Preview de staging — fonte única consumida por
// playwright.config.js e pelos testes focados (ticket #118).
//
// Regras (modos mutuamente exclusivos):
// - Modo local nunca herda uma URL de staging implicitamente: STAGING_BASE_URL é
//   ignorado no modo local; configurar contraditoriamente falha fechada aqui,
//   antes do primeiro request HTTP.
// - Modo Preview (APP_ENV=preview) roda SOMENTE a suíte controlada definida em
//   scripts/lib/staging-e2e-specs.mjs contra a origem de staging atestada.

export const LOCAL_E2E_PORT = 5173;

function parseOrigin(value, label) {
  let parsed;
  try {
    parsed = new globalThis.URL(String(value ?? '').trim());
  } catch {
    throw new Error(`${label} must be a valid HTTP(S) origin without credentials`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${label} must be a valid HTTP(S) origin without credentials`);
  }
  return parsed.origin;
}

function normalized(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isStagingMode(env = process.env) {
  return normalized(env.APP_ENV) === 'preview';
}

/**
 * Resolve o baseURL efetivo para o modo atual. Falha fechada quando o modo
 * local aponta (mesmo acidentalmente) para a origem de staging, ou quando o
 * Preview está sem alvo/contraditório. Nunca retorna segredos nem URLs além
 * da origem validada.
 */
export function resolveE2eBaseUrl(env = process.env, { port = LOCAL_E2E_PORT } = {}) {
  const staging = env.STAGING_BASE_URL ? parseOrigin(env.STAGING_BASE_URL, 'STAGING_BASE_URL') : null;

  if (!isStagingMode(env)) {
    // Modo local: somente alvo local EXPLICITamente configurado (BASE_URL);
    // STAGING_BASE_URL presente no ambiente é deliberadamente ignorado.
    const localBase = env.BASE_URL
      ? parseOrigin(env.BASE_URL, 'BASE_URL')
      : `http://localhost:${port}`;
    if (staging && String(env.BASE_URL ?? '').trim() && localBase === staging) {
      throw new Error(
        'Configuração contraditória: BASE_URL aponta para a origem de staging sem APP_ENV=preview.'
      );
    }
    return localBase;
  }

  if (!staging) throw new Error('APP_ENV=preview exige STAGING_BASE_URL.');
  if (env.BASE_URL && parseOrigin(env.BASE_URL, 'BASE_URL') !== staging) {
    throw new Error('BASE_URL must match STAGING_BASE_URL during staging E2E');
  }
  return staging;
}
