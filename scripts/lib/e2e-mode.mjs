// Seleção de modo E2E: local vs Preview — fonte única consumida por
// playwright.config.js e pelos testes focados (ticket #118).
//
// Regras (modos mutuamente exclusivos):
// - Modo local nunca herda uma URL de Preview implicitamente: PREVIEW_BASE_URL
//   é ignorada no modo local; configurar contraditoriamente falha fechada aqui,
//   antes do primeiro request HTTP.
// - Modo Preview (APP_ENV=preview) roda SOMENTE a suíte controlada definida em
//   scripts/lib/preview-e2e-specs.mjs contra a origem do deployment atestado.

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
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export function isPreviewMode(env = process.env) {
  return normalized(env.APP_ENV) === 'preview';
}

/**
 * Resolve o baseURL efetivo para o modo atual. Falha fechada quando o modo
 * local aponta (mesmo acidentalmente) para a origem do Preview, ou quando o
 * Preview está sem alvo/contraditório. Nunca retorna segredos nem URLs além da
 * origem validada.
 */
export function resolveE2eBaseUrl(env = process.env, { port = LOCAL_E2E_PORT } = {}) {
  const preview = env.PREVIEW_BASE_URL
    ? parseOrigin(env.PREVIEW_BASE_URL, 'PREVIEW_BASE_URL')
    : null;

  if (!isPreviewMode(env)) {
    // Modo local: somente alvo local EXPLICITamente configurado (BASE_URL);
    // PREVIEW_BASE_URL presente no ambiente é deliberadamente ignorado.
    const localBase = env.BASE_URL
      ? parseOrigin(env.BASE_URL, 'BASE_URL')
      : `http://localhost:${port}`;
    if (preview && String(env.BASE_URL ?? '').trim() && localBase === preview) {
      throw new Error(
        'Configuração contraditória: BASE_URL aponta para a origem de Preview sem APP_ENV=preview.'
      );
    }
    return localBase;
  }

  if (!preview) throw new Error('APP_ENV=preview exige PREVIEW_BASE_URL.');
  if (env.BASE_URL && parseOrigin(env.BASE_URL, 'BASE_URL') !== preview) {
    throw new Error('BASE_URL must match PREVIEW_BASE_URL during Preview E2E');
  }
  return preview;
}
