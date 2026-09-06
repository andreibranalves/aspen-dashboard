import { createHash } from 'node:crypto';
import { getKvClient } from '../_infrastructure/integrations/kv/client.js';
import { isKvConfigured } from '../_infrastructure/integrations/kv/config.js';
import type { VercelRequestLike } from '../_http/types.js';
import { getRouteName } from './auth.js';

const kv = getKvClient();

const WINDOW_MS = 60_000;
const WINDOW_SECONDS = 60;
const ATOMIC_INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;

type KvEval = <T = unknown>(script: string, keys: string[], args: unknown[]) => Promise<T>;

export const rateLimitKv: { eval: KvEval } = {
  eval: (script, keys, args) => kv.eval(script, keys, args),
};

const ROUTE_LIMITS: Record<string, number> = {
  extract: 10,
  orcamento: 20,
  'send-whatsapp': 5,
  login: 10,
  'public-quotation': 20,
  'site-quote-leads': 30,
};

interface BucketEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, BucketEntry>();

function localRateLimit(req: VercelRequestLike): boolean {
  const routeName = getRouteName(req);
  const max = ROUTE_LIMITS[routeName];
  if (!max) return true;
  const headers = (req.headers || {}) as Record<string, string | string[] | undefined>;
  const ip = (headers['x-real-ip'] as string | undefined)?.trim() || 'unknown';
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
      for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
    }
    return false;
  }
  return true;
}

/** Synchronous limiter retained for non-public legacy routes and local callers. */
export function checkRateLimit(req: VercelRequestLike): boolean {
  return localRateLimit(req);
}

function publicRateLimitKey(req: VercelRequestLike): string {
  const url = new URL(req.url || '/', 'http://localhost');
  const token = url.searchParams.get('token') || '';
  if (token) return `public-token:${createHash('sha256').update(token).digest('hex')}`;
  const socketAddress = (req as VercelRequestLike & { socket?: { remoteAddress?: string } }).socket?.remoteAddress;
  // Forwarded headers are caller-controlled here; use the platform socket
  // identity and fall back to one fail-closed bucket when unavailable.
  const socketIdentity = String(socketAddress || 'unknown').trim() || 'unknown';
  return `public-ip:${createHash('sha256').update(socketIdentity).digest('hex')}`;
}

/**
 * Public links use shared atomic KV in every deployed/self-hosted runtime.
 * Missing KV or an unavailable provider fails closed instead of pretending a
 * process-local map is globally protective.
 */
export async function checkRateLimitAsync(req: VercelRequestLike): Promise<boolean> {
  const routeName = getRouteName(req);
  if (routeName !== 'public-quotation') return localRateLimit(req);
  if (!isKvConfigured()) return false;
  const max = ROUTE_LIMITS[routeName];
  try {
    const key = `aspen:rate-limit:${routeName}:${publicRateLimitKey(req)}`;
    const count = await rateLimitKv.eval<number>(ATOMIC_INCREMENT_SCRIPT, [key], [WINDOW_SECONDS]);
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1)
      throw new Error('invalid shared limiter count');
    return count <= max;
  } catch (error) {
    console.error(`[rate-limit] shared limiter unavailable (${error instanceof Error ? error.name : typeof error})`);
    return false;
  }
}
