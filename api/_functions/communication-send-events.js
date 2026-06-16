// GET /api/communication-send-events
//
// Lists WhatsApp flow send events from KV.
// Query params: quotation_id, phone, flow_id, status, limit (default 50)
//
// Storage: Vercel KV keys aspen:communication:send-events:{id}
// TTL: 7 days (set by send-whatsapp-flow.js on write)

import { kv } from '@vercel/kv';
import { KV_KEY_SEND_EVENTS_PREFIX } from '../_lib/media-schema.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Método não permitido.' });

  try {
    const q = event.queryStringParameters || {};

    // Scan all send-event keys
    let keys = [];
    try {
      const result = await kv.scan(0, { match: `${KV_KEY_SEND_EVENTS_PREFIX}*`, count: 200 });
      keys = result[1] || [];
    } catch {
      return jsonResponse(200, { success: true, items: [], source: 'kv-empty' });
    }

    if (keys.length === 0) {
      return jsonResponse(200, { success: true, items: [], source: 'kv' });
    }

    // Fetch all events
    const entries = await Promise.all(keys.map((k) => kv.get(k)));
    let items = entries.filter(Boolean);

    // Filters
    const quotationId = String(q.quotation_id || '').trim();
    const phone = String(q.phone || '').trim();
    const flowId = String(q.flow_id || '').trim();
    const status = String(q.status || '').trim();

    if (quotationId) items = items.filter((e) => e.quotation_id === quotationId);
    if (phone) items = items.filter((e) => e.phone === phone);
    if (flowId) items = items.filter((e) => e.flow_id === flowId);
    if (status && ['pending', 'sent', 'failed', 'skipped'].includes(status)) {
      items = items.filter((e) => e.status === status);
    }

    // Sort by created_at descending (most recent first)
    items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    // Limit
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    items = items.slice(0, limit);

    return jsonResponse(200, {
      success: true,
      items,
      total: items.length,
      source: 'kv',
    });
  } catch (err) {
    console.error('[comm-send-events]', err?.logMessage || err?.message || err);
    return jsonResponse(500, { error: err?.message || 'Erro ao listar histórico.' });
  }
}
