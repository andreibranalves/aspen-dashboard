import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { erpGetList, erpPost, erpDelete, createHttpError } from './lib/erpnext.js';

// ── Helpers ──

function parsePageLimit(params: Record<string, string | undefined>): { page: number; limit: number } {
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(params.limit || '50', 10) || 50));
  return { page, limit };
}

function buildFilters(params: Record<string, string | undefined>): Array<Array<string | number>> {
  const filters: Array<Array<string | number>> = [['disabled', '=', 0]];
  if (params.categoria) {
    filters.push(['item_group', '=', params.categoria]);
  }
  return filters;
}

function buildOrFilters(params: Record<string, string | undefined>): Array<Array<string>> | undefined {
  if (!params.search) return undefined;
  const term = params.search.trim();
  if (!term) return undefined;
  return [
    ['item_name', 'like', `%${term}%`],
    ['item_code', 'like', `%${term}%`],
  ];
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

function mapItem(
  item: Record<string, unknown>,
  pricesMap: Record<string, number>,
): Record<string, unknown> {
  const sku = item.item_code as string;
  return {
    sku,
    nome: item.item_name,
    descricao: stripHtml(String(item.description || '')),
    unidade: item.stock_uom,
    ativo: (item as Record<string, number>).disabled === 0,
    preco_minimo: pricesMap[sku] ?? null,
  };
}

// ── Handler ──

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
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
      const skus = items.map(i => i.item_code as string).filter(Boolean);
      let pricesMap: Record<string, number> = {};
      if (skus.length > 0) {
        try {
          const itemPrices = await erpGetList('Item Price', {
            fields: ['item_code', 'price_list_rate'],
            filters: [
              ['item_code', 'in', skus] as unknown as (string | number)[],
              ['price_list', '=', 'Standard Selling'],
            ],
            order_by: 'price_list_rate asc',
            limit: 10000,
          });
          for (const p of itemPrices) {
            const code = p.item_code as string;
            const rate = p.price_list_rate != null ? Number(p.price_list_rate) : null;
            if (rate != null && !Number.isNaN(rate)) {
              // Keep the lowest rate (since we sorted asc)
              if (!pricesMap[code] || rate < pricesMap[code]) {
                pricesMap[code] = rate;
              }
            }
          }
        } catch (e: unknown) {
          console.warn('[products] Failed to fetch item prices:', (e as Error).message);
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
      const code = Number.isInteger((err as Record<string, unknown>).statusCode) ? (err as Record<string, unknown>).statusCode as number : 500;
      console.error('[products] GET', (err as Record<string, unknown>).logMessage || (err as Record<string, unknown>).message || err);
      return {
        statusCode: code,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: (err as Error).message || 'Erro interno.' }),
      };
    }
  }

  // POST — create a new product
  if (event.httpMethod === 'POST') {
    try {
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(event.body) as Record<string, unknown>; }
      catch { throw createHttpError(400, 'JSON inválido.'); }

      const sku = String(payload.sku || '').trim();
      const nome = String(payload.nome || '').trim();

      if (!sku) throw createHttpError(400, 'SKU é obrigatório.');
      if (!nome) throw createHttpError(400, 'Nome do produto é obrigatório.');

      const itemPayload: Record<string, unknown> = {
        item_code: sku,
        item_name: nome,
        is_stock_item: 0,
        stock_uom: String(payload.unidade || 'Und').trim(),
      };
      if (payload.categoria) itemPayload.item_group = String(payload.categoria).trim();

      const created = await erpPost('Item', itemPayload);

      return {
        statusCode: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, created: (created as Record<string, unknown>).name || created }),
      };
    } catch (err) {
      const code = Number.isInteger((err as Record<string, unknown>).statusCode) ? (err as Record<string, unknown>).statusCode as number : 500;
      console.error('[products] POST', (err as Record<string, unknown>).logMessage || (err as Record<string, unknown>).message || err);
      return {
        statusCode: code,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: (err as Error).message || 'Erro ao criar produto.' }),
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
      const code = Number.isInteger((err as Record<string, unknown>).statusCode) ? (err as Record<string, unknown>).statusCode as number : 500;
      console.error('[products] DELETE', (err as Record<string, unknown>).logMessage || (err as Record<string, unknown>).message || err);
      return {
        statusCode: code,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: (err as Error).message || 'Erro ao excluir produto.' }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Method Not Allowed' }),
  };
}
