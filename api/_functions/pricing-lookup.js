// ── Imports ─────────────────────────────────────────────────────────────────
import { getBracket, getRate, getUrgentRate } from './pricing.js';

// ── Constants ───────────────────────────────────────────────────────────────
const ERPNEXT_BASE = 'https://aspenestamparia.l.frappe.cloud';
const ERPNEXT_TOKEN = process.env.ERPNEXT_TOKEN;

// ── Handler ─────────────────────────────────────────────────────────────────
export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  try {
    const { items: inputItems, urgent } = payload;

    if (!Array.isArray(inputItems)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Items deve ser um array.' }),
      };
    }

    // ── Build dedup map: one entry per unique (item_code, bracket) pair ──
    // key → { item_code, qty, indices[] (into output) }
    const dedupMap = new Map();
    const results = new Array(inputItems.length);

    for (let i = 0; i < inputItems.length; i++) {
      const item = inputItems[i];
      const { item_code, qty } = item;

      // Skip invalid items — store null rate immediately
      if (!item_code || qty <= 0) {
        results[i] = { item_code: item_code || '', qty: qty || 0, rate: null };
        continue;
      }

      const key = `${item_code}::${getBracket(qty)}`;
      if (!dedupMap.has(key)) {
        dedupMap.set(key, { item_code, qty, indices: [] });
      }
      dedupMap.get(key).indices.push(i);
    }

    // ── Parallel resolution ──────────────────────────────────────────────
    const uniqueKeys = [...dedupMap.keys()];
    const settled = await Promise.allSettled(
      uniqueKeys.map((key) => {
        const { item_code, qty } = dedupMap.get(key);
        return getRate(item_code, qty, ERPNEXT_BASE, ERPNEXT_TOKEN);
      })
    );

    // Map resolved rates back to each dedup entry
    for (let k = 0; k < uniqueKeys.length; k++) {
      const key = uniqueKeys[k];
      const entry = dedupMap.get(key);
      let rate;

      if (settled[k].status === 'fulfilled') {
        rate = settled[k].value;
      } else {
        console.error('[pricing-lookup]', `Falha ao resolver ${key}:`, settled[k].reason?.message || settled[k].reason);
        rate = 0;
      }

      // Apply urgent markup (skip null/0)
      if (urgent === true && rate > 0) {
        rate = getUrgentRate(rate);
      }

      // Write to all output indices sharing this dedup key
      for (const idx of entry.indices) {
        results[idx] = { item_code: entry.item_code, qty: entry.qty, rate };
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, items: results }),
    };
  } catch (err) {
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[pricing-lookup]', err?.logMessage || err?.message || err);
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.message || 'Erro interno.' }),
    };
  }
}
