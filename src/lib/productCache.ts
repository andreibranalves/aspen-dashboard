// src/lib/productCache.ts
// In-memory cache for product search results with configurable TTL.
// Products rarely change — 5 min TTL avoids redundant API calls during
// repeated searches (type, backspace, re-type).

import type { Product, ProductsApiResponse } from '@/types/domain';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  data: Product[];
  ts: number;
}

const cache = new Map<string, CacheEntry>();

function getKey(query: string | null | undefined, limit: number): string {
  return `${(query || '').toLowerCase().trim()}::${limit || 8}`;
}

/**
 * Search products with in-memory cache.
 * Returns array of product objects [{ sku, nome, ... }].
 * Cache hit returns instantly; cache miss fetches from API.
 */
export async function searchProducts(
  query?: string | null,
  limit = 8,
): Promise<Product[]> {
  const key = getKey(query, limit);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  const url = `/api/products?search=${encodeURIComponent(String(query))}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn('[productCache] API error', res.status);
    return [];
  }
  const json = (await res.json().catch(() => ({ data: [] }))) as ProductsApiResponse;
  const data = json.data || [];

  cache.set(key, { data, ts: Date.now() });
  return data;
}

/** Clear entire cache (e.g. after product import/sync). */
export function clearProductCache(): void {
  cache.clear();
}
