// ── Imports ─────────────────────────────────────────────────────────────────
import { erpGetList } from './lib/erpnext.js';

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const params = event.queryStringParameters || {};
  const sku = (params.sku || '').trim();

  if (!sku) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'SKU é obrigatório.' }),
    };
  }

  const limit = Math.min(20, Math.max(1, parseInt(params.limit, 10) || 10));

  try {
    const atividades = [];

    // ── 1. Orçamentos recentes que contêm este SKU ──
    const quoteItems = await erpGetList('Quotation Item', {
      fields: ['parent', 'qty', 'modified'],
      filters: [['item_code', '=', sku]],
      order_by: 'modified desc',
      limit,
    });

    for (const qi of quoteItems) {
      atividades.push({
        tipo: 'orcamento',
        texto: `Orçamento ${qi.parent} criado com ${qi.qty || '?'} un.`,
        data: (qi.modified || '').split(' ')[0],
        id: qi.parent,
        ts: qi.modified || '',
      });
    }

    // ── 2. Alterações de preço via Version ──
    const priceVersions = await erpGetList('Version', {
      fields: ['docname', 'data', 'modified'],
      filters: [
        ['ref_doctype', '=', 'Pricing Rule'],
        ['docname', 'like', `${sku}-%`],
      ],
      order_by: 'modified desc',
      limit,
    });

    // ── 3. Atualizações do produto via Version ──
    const itemVersions = await erpGetList('Version', {
      fields: ['docname', 'data', 'modified'],
      filters: [
        ['ref_doctype', '=', 'Item'],
        ['docname', '=', sku],
      ],
      order_by: 'modified desc',
      limit: 5,
    });

    // Processar price versions
    for (const v of priceVersions) {
      let texto = `Preço da regra ${v.docname} alterado`;
      try {
        const parsed = typeof v.data === 'string' ? JSON.parse(v.data) : v.data;
        const changed = parsed?.changed;
        if (Array.isArray(changed)) {
          for (const c of changed) {
            if (c[0] === 'rate' || c[0] === 'title') {
              texto = `Preço alterado em ${v.docname}: R$ ${c[1] || '?'} → R$ ${c[2] || '?'}`;
            }
          }
        }
      } catch { /* mantém texto default */ }
      atividades.push({
        tipo: 'preco',
        texto,
        data: (v.modified || '').split(' ')[0],
        id: v.docname,
        ts: v.modified || '',
      });
    }

    // Processar item versions
    for (const v of itemVersions) {
      let texto = 'Produto atualizado';
      try {
        const parsed = typeof v.data === 'string' ? JSON.parse(v.data) : v.data;
        const changed = parsed?.changed;
        if (Array.isArray(changed)) {
          const fieldNames = changed.map(c => c[0]).filter(Boolean);
          texto = `Produto atualizado: ${fieldNames.join(', ')}`;
        }
      } catch { /* mantém texto default */ }
      atividades.push({
        tipo: 'produto',
        texto,
        data: (v.modified || '').split(' ')[0],
        id: v.docname,
        ts: v.modified || '',
      });
    }

    // Ordenar por data decrescente, limitar, remover ts
    atividades.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
    const result = atividades.slice(0, limit).map(({ ts, ...rest }) => rest);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, atividades: result }),
    };
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[product-activity]', err?.logMessage || err?.message || err);
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Erro ao buscar atividades do produto.' }),
    };
  }
}
