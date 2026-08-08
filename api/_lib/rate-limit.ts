import { createHash } from 'node:crypto';
import { kv } from '@vercel/kv';
import type { VercelRequestLike } from './types.js';
import { getRouteName } from './auth.js';

const WINDOW_MS = 60_000;
const WINDOW_SECONDS = 60;

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
  return `public-ip:${String(socketAddress || 'unknown').trim()}`;
}

/**
 * Public links use shared atomic KV in every deployed/self-hosted runtime.
 * Missing KV or an unavailable provider fails closed instead of pretending a
 * process-local map is globally protective.
 */
export async function checkRateLimitAsync(req: VercelRequestLike): Promise<boolean> {
  const routeName = getRouteName(req);
  if (routeName !== 'public-quotation') return localRateLimit(req);
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return false;
  const max = ROUTE_LIMITS[routeName];
  const key = `aspen:rate-limit:${routeName}:${publicRateLimitKey(req)}`;
  try {
    const count = await kv.incr(key);
    if (count === 1) await kv.expire(key, WINDOW_SECONDS);
    return count <= max;
  } catch (error) {
    console.error(`[rate-limit] shared limiter unavailable (${error instanceof Error ? error.name : typeof error})`);
    return false;
  }
}
