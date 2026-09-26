import type { VercelRequestLike } from '../_http/types.js';
import { isValidPasswordHash } from './password.js';
import { isValidSessionSecret, SESSION_COOKIE_NAME, verifySessionToken } from './session.js';

const AUTH_ROUTES = new Set(['login', 'logout']);
const MACHINE_ROUTES = new Set([
  'evolution-webhook',
  'site-quote-leads',
  'whatsapp-backfill',
]);
const MAX_COOKIE_HEADER_LENGTH = 8192;

export interface AuthEnvironment {
  APP_PASSWORD_HASH?: string;
  APP_SESSION_SECRET?: string;
  APP_AUTH_BYPASS?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
}

export interface AuthConfiguration {
  passwordHash: string | undefined;
  sessionSecret: string | undefined;
  isValid: boolean;
}

function isProductionValue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'production';
}

export function isProductionEnvironment(environment: AuthEnvironment = process.env): boolean {
  return isProductionValue(environment.NODE_ENV) || isProductionValue(environment.VERCEL_ENV);
}

/**
 * A bypass is deliberately opt-in and is never available when either runtime
 * marks the deployment as production.
 */
export function isDevelopmentAuthBypassEnabled(environment: AuthEnvironment = process.env): boolean {
  return environment.APP_AUTH_BYPASS === 'true' && !isProductionEnvironment(environment);
}

export function getAuthConfiguration(environment: AuthEnvironment = process.env): AuthConfiguration {
  const passwordHash = environment.APP_PASSWORD_HASH;
  const sessionSecret = environment.APP_SESSION_SECRET;

  return {
    passwordHash,
    sessionSecret,
    isValid: isValidPasswordHash(passwordHash) && isValidSessionSecret(sessionSecret),
  };
}

export function isMachineRoute(routeName: string): boolean {
  return MACHINE_ROUTES.has(routeName);
}

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
  if (!cookieHeader || cookieHeader.length > MAX_COOKIE_HEADER_LENGTH) return map;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key && map[key] === undefined) map[key] = value;
  }
  return map;
}

export function isAuthenticated(
  req: VercelRequestLike,
  environment: AuthEnvironment = process.env
): boolean {
  const routeName = getRouteName(req);
  const method = String(req.method || '').toUpperCase();
  if (routeName === 'whatsapp-context' && method === 'OPTIONS') return true;
  if (isMachineRoute(routeName)) return true;
  if (routeName === 'public-quotation' && method === 'GET') return true;
  if (AUTH_ROUTES.has(routeName)) return true;

  if (isDevelopmentAuthBypassEnabled(environment)) return true;

  const configuration = getAuthConfiguration(environment);
  if (!configuration.isValid || !configuration.sessionSecret) return false;

  const headers = (req.headers || {}) as Record<string, string | string[] | undefined>;
  const headerValue = headers.cookie ?? headers.Cookie;
  const cookieHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const cookies = parseCookies(cookieHeader);
  return verifySessionToken(cookies[SESSION_COOKIE_NAME], configuration.sessionSecret);
}
