import { erpGetList, erpPost, erpDelete, createHttpError } from './lib/erpnext.js';

// ── Helpers ──

function parsePageLimit(params) {
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(params.limit, 10) || 50));
  return { page, limit };
}

function buildFilters(params) {
  const filters = [['disabled', '=', 0]];
  if (params.categoria) {
    filters.push(['item_group', '=', params.categoria]);
  }
  return filters;
}

function buildOrFilters(params) {
  if (!params.search) return undefined;
  const term = params.search.trim();
  if (!term) return undefined;
  return [
    ['item_name', 'like', `%${term}%`],
    ['item_code', 'like', `%${term}%`],
  ];
}

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

function mapItem(item, pricesMap) {
  const sku = item.item_code;
  return {
    sku,
    nome: item.item_name,
    descricao: stripHtml(item.description || ''),
    unidade: item.stock_uom,
    ativo: item.disabled === 0,
    preco_minimo: pricesMap[sku] ?? null,
  };
}

// ── Handler ──

export async function handler(event) {
  // GET — list products
  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      const { page, limit } = parsePageLimit(params);
      const order_by = params.order_by || 'modified desc';
      const filters = buildFilters(params);
      const or_filters = buildOrFilters(params);
      const start = (page - 1) * limit;

      const [items, countItems] = await Promise.all([
        erpGetList('Item', {
          fields: ['item_code', 'item_name', 'description', 'item_group', 'stock_uom', 'disabled'],
          filters,
          or_filters,
          order_by,
          limit,
          start,
        }),
        erpGetList('Item', {
          fields: ['item_code'],
          filters,
          or_filters,
          limit: 10000,
        }),
      ]);

      // ── Batch-fetch lowest prices ──
      const skus = items.map(i => i.item_code).filter(Boolean);
      let pricesMap = {};
      if (skus.length > 0) {
        try {
          const itemPrices = await erpGetList('Item Price', {
            fields: ['item_code', 'price_list_rate'],
            filters: [
              ['item_code', 'in', skus],
              ['price_list', '=', 'Standard Selling'],
            ],
            order_by: 'price_list_rate asc',
            limit: 10000,
          });
          for (const p of itemPrices) {
            const code = p.item_code;
            const rate = p.price_list_rate != null ? Number(p.price_list_rate) : null;
            if (rate != null && !Number.isNaN(rate)) {
              // Keep the lowest rate (since we sorted asc)
              if (!pricesMap[code] || rate < pricesMap[code]) {
                pricesMap[code] = rate;
              }
            }
          }
        } catch (e) {
          console.warn('[products] Failed to fetch item prices:', e.message);
        }
      }

      const data = items.map(item => mapItem(item, pricesMap));
      const total = countItems.length;

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data,
          pagination: {
            page,
            limit,
            total,
            total_pages: Math.ceil(total / limit) || 0,
          },
        }),
      };
    } catch (err) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[products] GET', err?.logMessage || err?.message || err);
      return {
        statusCode: code,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err?.message || 'Erro interno.' }),
      };
    }
  }

  // POST — create a new product
  if (event.httpMethod === 'POST') {
    try {
      let payload;
      try { payload = JSON.parse(event.body); }
      catch { throw createHttpError(400, 'JSON inválido.'); }

      const sku = (payload.sku || '').trim();
      const nome = (payload.nome || '').trim();

      if (!sku) throw createHttpError(400, 'SKU é obrigatório.');
      if (!nome) throw createHttpError(400, 'Nome do produto é obrigatório.');

      const itemPayload = {
        item_code: sku,
        item_name: nome,
        is_stock_item: 0,
        stock_uom: (payload.unidade || 'Und').trim(),
      };
      if (payload.categoria) itemPayload.item_group = payload.categoria.trim();

      const created = await erpPost('Item', itemPayload);

      return {
        statusCode: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, created: created.name || created }),
      };
    } catch (err) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[products] POST', err?.logMessage || err?.message || err);
      return {
        statusCode: code,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err?.message || 'Erro ao criar produto.' }),
      };
    }
  }

  // DELETE — delete a single product
  if (event.httpMethod === 'DELETE') {
    try {
      const id = (event.queryStringParameters || {}).id;
      if (!id) {
        throw createHttpError(400, 'ID do produto não informado.');
      }

      await erpDelete('Item', id);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, deleted: id }),
      };
    } catch (err) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[products] DELETE', err?.logMessage || err?.message || err);
      return {
        statusCode: code,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err?.message || 'Erro ao excluir produto.' }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Method Not Allowed' }),
  };
}
