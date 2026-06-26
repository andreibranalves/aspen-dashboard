// GET    /api/communication-media        — list media assets (scan KV by prefix)
import type { FunctionEvent, FunctionResult, JsonResponseFn } from '../_lib/types.js';
// GET    /api/communication-media/:id    — single media asset
// POST   /api/communication-media        — create media asset metadata (after Blob upload)
// PUT    /api/communication-media/:id    — update media asset
// DELETE /api/communication-media/:id    — delete media asset
//
// Storage: Vercel KV per-id keys: aspen:communication:media-assets:{id}
// Binary files: Vercel Blob (public store, URLs stored in KV metadata)

import { kv } from '@vercel/kv';
import { del as blobDelete } from '@vercel/blob';
import { createHttpError } from './lib/erpnext.js';
import {
  KV_KEY_MEDIA_PREFIX,
  PRODUCT_GROUPS,
  ALLOWED_MIME_TYPES,
  createMediaAsset,
} from '../_lib/media-schema.js';

// ── Path extraction ────────────────────────────────────────────────────────

/**
 * Extract resource ID from the URL path after /api/communication-media/
 */
function extractId(event: Record<string, any>): string | null {
  const queryId = String(event.queryStringParameters?.id || '').trim();
  if (queryId) return queryId;

  try {
    // Strip query string before parsing path
    const url = (event.url || event.rawUrl || '').split('?')[0];
    const parts = url.replace(/^\/api\/communication-media\/?/, '').split('/');
    const id = parts[0]?.trim();
    return id || null;
  } catch {
    return null;
  }
}

// ── KV helpers ─────────────────────────────────────────────────────────────

async function scanMediaKeys(): Promise<string[]> {
  // kv.scanIterator requires Node 18+ / Vercel Edge compatible
  try {
    const result = await kv.scan(0, { match: `${KV_KEY_MEDIA_PREFIX}*`, count: 200 });
    return (result[1] || []).sort();
  } catch {
    // scan may not be available in all environments
    return [];
  }
}

async function readAllMedia(): Promise<unknown[]> {
  try {
    const keys = await scanMediaKeys();
    if (keys.length === 0) return [];
    const entries = await Promise.all(keys.map((k) => kv.get(k)));
    return entries.filter(Boolean);
  } catch (err: any) {
    console.warn('[communication-media] KV read all failed:', err.message);
    return [];
  }
}

async function readMedia(id: string): Promise<any[] | null> {
  try {
    return (await kv.get(`${KV_KEY_MEDIA_PREFIX}${id}`)) as any[] | null;
  } catch (err: any) {
    console.warn(`[communication-media] KV read ${id} failed:`, err.message);
    return null;
  }
}

async function writeMedia(asset: Record<string, any>): Promise<void> {
  try {
    await kv.set(`${KV_KEY_MEDIA_PREFIX}${asset.id}`, asset);
  } catch (err: any) {
    throw createHttpError(
      500,
      'Falha ao salvar metadados de mídia.',
      `[communication-media] KV write ${asset.id} failed: ${err.message}`
    );
  }
}

async function deleteMediaFromKV(id: string): Promise<void> {
  try {
    await kv.del(`${KV_KEY_MEDIA_PREFIX}${id}`);
  } catch (err: any) {
    console.warn(`[communication-media] KV del ${id} failed:`, err.message);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const jsonResponse: JsonResponseFn = (statusCode, body) => {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
};

function filterItems(items: Record<string, unknown>[], query: Record<string, string> = {}) {
  let filtered = items;

  if (query.product_group) {
    const group = String(query.product_group).trim().toLowerCase();
    filtered = filtered.filter((m: Record<string, unknown>) => m.product_group === group);
  }
  if (query.active !== undefined && query.active !== '') {
    const active = query.active === '1' || query.active === 'true';
    filtered = filtered.filter((m: Record<string, unknown>) => m.active === active);
  }
  if (query.kind && ALLOWED_MIME_TYPES.find((t) => t.startsWith(query.kind))) {
    filtered = filtered.filter((m: Record<string, unknown>) => m.kind === query.kind);
  }
  if (query.product_code) {
    const code = String(query.product_code).trim().toUpperCase();
    filtered = filtered.filter((m: Record<string, unknown>) => m.product_code === code);
  }
  return filtered;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  const method = event.httpMethod || 'GET';
  const id = extractId(event);

  // ── GET: List all media ──
  if (method === 'GET' && !id) {
    try {
      let items: Record<string, unknown>[] = (await readAllMedia()) as Record<string, unknown>[];
      const q: Record<string, string> = (event.queryStringParameters || {}) as Record<
        string,
        string
      >;
      items = filterItems(items, q as Record<string, string>);

      // Sort by sort_order then created_at desc
      items.sort(
        (a, b) =>
          Number(a.sort_order) - Number(b.sort_order) ||
          String(b.created_at || '').localeCompare(String(a.created_at || ''))
      );

      return jsonResponse(200, { success: true, items });
    } catch (err: any) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[communication-media]', err?.logMessage || err?.message || err);
      return jsonResponse(code, { error: err?.message || 'Erro ao listar mídias.' });
    }
  }

  // ── GET: Single media ──
  if (method === 'GET' && id) {
    try {
      const media = await readMedia(id);
      if (!media) return jsonResponse(404, { error: 'Mídia não encontrada.' });
      return jsonResponse(200, { success: true, item: media });
    } catch (err: any) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[communication-media]', err?.logMessage || err?.message || err);
      return jsonResponse(code, { error: err?.message || 'Erro ao buscar mídia.' });
    }
  }

  // ── POST: Create media ──
  if (method === 'POST') {
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'JSON inválido.' });
    }

    // Validation
    const errors = [];
    if (!payload.title || !String(payload.title).trim()) errors.push('Título é obrigatório.');
    if (
      !payload.product_group ||
      !PRODUCT_GROUPS.includes(String(payload.product_group).trim().toLowerCase())
    ) {
      errors.push(`Grupo de produto inválido. Use: ${PRODUCT_GROUPS.join(', ')}.`);
    }
    if (!payload.blob_url && !payload.blobUrl && !payload.url)
      errors.push('URL do blob é obrigatória.');
    if (errors.length > 0) return jsonResponse(400, { error: errors.join(' ') });

    try {
      const asset = createMediaAsset(payload);
      await writeMedia(asset);
      return jsonResponse(201, { success: true, item: asset });
    } catch (err: any) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[communication-media]', err?.logMessage || err?.message || err);
      return jsonResponse(code, { error: err?.message || 'Erro ao criar mídia.' });
    }
  }

  // ── PUT: Update media ──
  if (method === 'PUT' && id) {
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'JSON inválido.' });
    }

    try {
      const existing = await readMedia(id);
      if (!existing) return jsonResponse(404, { error: 'Mídia não encontrada.' });

      const updatableFields = [
        'title',
        'description',
        'product_group',
        'product_code',
        'kind',
        'caption',
        'active',
        'sort_order',
        'blob_url',
        'pathname',
        'content_type',
        'size_bytes',
      ];
      const merged: Record<string, unknown> = { ...(existing as any as Record<string, unknown>) };
      for (const field of updatableFields) {
        if (payload[field] !== undefined) merged[field] = payload[field];
      }
      merged.updated_at = new Date().toISOString();

      const asset = createMediaAsset(merged as Record<string, any>);
      await writeMedia(asset);
      return jsonResponse(200, { success: true, item: asset });
    } catch (err: any) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[communication-media]', err?.logMessage || err?.message || err);
      return jsonResponse(code, { error: err?.message || 'Erro ao atualizar mídia.' });
    }
  }

  if (method === 'PUT' && !id) {
    return jsonResponse(400, { error: 'ID da mídia é obrigatório para atualização.' });
  }

  // ── DELETE: Remove media ──
  if (method === 'DELETE' && id) {
    try {
      const existing = await readMedia(id);
      const existingRecord = existing as any as Record<string, unknown> | null;
      if (!existingRecord) return jsonResponse(404, { error: 'Mídia não encontrada.' });

      // Attempt Blob deletion (best-effort, non-blocking)
      if (existingRecord.blob_url) {
        try {
          await blobDelete(existingRecord.blob_url as string);
        } catch (blobErr: any) {
          console.warn(
            `[communication-media] Blob delete failed for ${existingRecord.blob_url}:`,
            blobErr.message
          );
        }
      }

      await deleteMediaFromKV(id);
      return jsonResponse(200, { success: true, deleted: id });
    } catch (err: any) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[communication-media]', err?.logMessage || err?.message || err);
      return jsonResponse(code, { error: err?.message || 'Erro ao remover mídia.' });
    }
  }

  // ── Unsupported ──
  return jsonResponse(405, { error: 'Método não permitido.' });
}
