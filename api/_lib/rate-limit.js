// ── Rate limiter in-memory ───────────────────────────────────────────────────
//
// Simples e suficiente para Vercel serverless.
// Reseta entre cold starts, mas protege contra abuso básico em rajada.

import { getRouteName } from './auth.js';

const WINDOW_MS = 60_000; // 1 minuto

// Limites por rota (requisições por janela de 1 minuto)
const ROUTE_LIMITS = {
  extract: 10,
  orcamento: 20,
  'send-whatsapp': 5,
  'typebot-lead-capture': 20,
  login: 10,
};

const buckets = new Map(); // key → { count, resetAt }

/**
 * Retorna true se a requisição está dentro do limite.
 * Retorna false se o limite foi excedido → responder 429.
 */
export function checkRateLimit(req) {
  const routeName = getRouteName(req);
  const max = ROUTE_LIMITS[routeName];
  if (!max) return true; // sem limite para esta rota

  const ip =
    req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers?.['x-real-ip'] ||
    'unknown';

  const key = `${ip}:${routeName}`;
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  entry.count++;
  if (entry.count > max) {
    // Limpeza periódica: remove entradas expiradas
    if (buckets.size > 1000) {
      for (const [k, v] of buckets) {
        if (now > v.resetAt) buckets.delete(k);
      }
    }
    return false;
  }

  return true;
}
