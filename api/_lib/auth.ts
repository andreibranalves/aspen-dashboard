import type { VercelRequestLike } from './types.js';

const APP_PASSWORD = process.env.APP_PASSWORD;

const PUBLIC_ROUTES = new Set(['view', 'typebot-lead-capture']);
const AUTH_ROUTES = new Set(['login', 'logout']);

export function getRouteName(req: VercelRequestLike): string {
  const path = req.query?.path;
  if (Array.isArray(path)) return path[0] as string;
  if (path) return path as string;

  try {
    const url = new URL(req.url || '/', 'https://aspen-orcamento.local');
    return url.pathname.replace(/^\/api\/?/, '').split('/')[0];
  } catch {
    return '';
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const map: Record<string, string> = {};
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

export function isAuthenticated(req: VercelRequestLike): boolean {
  if (!APP_PASSWORD) return true;

  const routeName = getRouteName(req);
  if (PUBLIC_ROUTES.has(routeName) || AUTH_ROUTES.has(routeName)) return true;

  const headers = (req.headers || {}) as Record<string, string | string[] | undefined>;
  const cookieHeader = Array.isArray(headers.cookie)
    ? headers.cookie[0]
    : (headers.cookie as string | undefined);
  const cookies = parseCookies(cookieHeader);
  if (cookies.aspen_token === APP_PASSWORD) return true;

  if ((headers as Record<string, string>)['x-aspen-key'] === APP_PASSWORD) return true;

  return false;
}
