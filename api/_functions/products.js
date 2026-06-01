import { erpGetList, erpDelete, createHttpError } from './lib/erpnext.js';

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

function mapItem(item) {
  return {
    sku: item.item_code,
    nome: item.item_name,
    categoria: item.item_group,
    unidade: item.stock_uom,
    ativo: item.disabled === 0,
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
          fields: ['item_code', 'item_name', 'item_group', 'stock_uom', 'disabled'],
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

      const data = items.map(mapItem);
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

  // Other methods
  return {
    statusCode: 405,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Method Not Allowed' }),
  };
}
