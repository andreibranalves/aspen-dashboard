import type { VercelRequestLike } from './types.js';
import { getRouteName } from './auth.js';

const WINDOW_MS = 60_000;

const ROUTE_LIMITS: Record<string, number> = {
  extract: 10,
  orcamento: 20,
  'send-whatsapp': 5,
  'typebot-lead-capture': 20,
  login: 10,
  'public-quotation': 20,
};

interface BucketEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, BucketEntry>();

export function checkRateLimit(req: VercelRequestLike): boolean {
  const routeName = getRouteName(req);
  const max = ROUTE_LIMITS[routeName];
  if (!max) return true;

  const headers = (req.headers || {}) as Record<string, string | string[] | undefined>;
  const forwarded = Array.isArray(headers['x-forwarded-for'])
    ? headers['x-forwarded-for'][0]
    : (headers['x-forwarded-for'] as string | undefined);
  const ip =
    forwarded?.split(',')[0]?.trim() || (headers['x-real-ip'] as string | undefined) || 'unknown';

  const key = `${ip}:${routeName}`;
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  entry.count++;
  if (entry.count > max) {
    if (buckets.size > 1000) {
      for (const [k, v] of buckets) {
        if (now > v.resetAt) buckets.delete(k);
      }
    }
    return false;
  }

  return true;
}
