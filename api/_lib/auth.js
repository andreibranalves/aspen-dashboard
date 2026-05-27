// ── Auth middleware ──────────────────────────────────────────────────────────

const APP_PASSWORD = process.env.APP_PASSWORD;

// Rotas que NÃO exigem autenticação
const PUBLIC_ROUTES = new Set(['view']);

// Rotas relacionadas a auth que devem ser acessíveis sem token
const AUTH_ROUTES = new Set(['login', 'logout']);

/**
 * Extrai o nome da rota da requisição (mesma lógica do router).
 */
export function getRouteName(req) {
  const path = req.query?.path;
  if (Array.isArray(path)) return path[0];
  if (path) return path;

  try {
    const url = new URL(req.url || '/', 'https://aspen-orcamento.local');
    return url.pathname.replace(/^\/api\/?/, '').split('/')[0];
  } catch {
    return '';
  }
}

/**
 * Faz parse de cookies do header.
 */
export function parseCookies(cookieHeader) {
  const map = {};
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) map[key] = value;
  }
  return map;
}

/**
 * Retorna true se a requisição está autenticada.
 *
 * Estratégia (em ordem):
 * 1. Se APP_PASSWORD não está configurado → permitir tudo (dev mode).
 * 2. Se a rota é pública (ex: view, login, logout) → permitir.
 * 3. Cookie httpOnly `aspen_token`.
 * 4. Header `x-aspen-key` (fallback para scripts/integrações).
 */
export function isAuthenticated(req) {
  // Dev mode — sem APP_PASSWORD configurada, tudo liberado
  if (!APP_PASSWORD) return true;

  const routeName = getRouteName(req);

  // Rotas públicas e de auth não exigem autenticação
  if (PUBLIC_ROUTES.has(routeName) || AUTH_ROUTES.has(routeName)) return true;

  // 1. Cookie httpOnly
  const cookies = parseCookies(req.headers?.cookie || '');
  if (cookies.aspen_token === APP_PASSWORD) return true;

  // 2. Header direto (fallback)
  if (req.headers?.['x-aspen-key'] === APP_PASSWORD) return true;

  return false;
}
