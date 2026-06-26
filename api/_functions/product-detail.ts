// ── Imports ─────────────────────────────────────────────────────────────────
import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { erpGetDoc } from './lib/erpnext.js';
import { resolveProductPricing } from './product-pricing.js';

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
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

  try {
    // Buscar Item por item_code
    let itemDoc;
    try {
      itemDoc = await erpGetDoc('Item', sku, {
        fields: ['item_code', 'item_name', 'item_group', 'stock_uom', 'disabled', 'image', 'description', 'brand', 'modified'],
      });
    } catch (err: any) {
      // erpGetDoc throws for 404 — tratamos como produto não encontrado
      if (err?.logMessage?.includes('404') || err?.message?.includes('404')) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Produto não encontrado.' }),
        };
      }
      throw err; // re-throw outros erros
    }

    if (!itemDoc) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Produto não encontrado.' }),
      };
    }

    // Buscar preços de todas as faixas com ordem de resolução:
    // Pricing Rule SKU-faixa → Pricing Rule SKU → Item Price Standard Selling.
    const precos = await resolveProductPricing(sku);

    const produto = {
      sku: itemDoc.item_code,
      nome: itemDoc.item_name,
      categoria: itemDoc.item_group,
      unidade: itemDoc.stock_uom,
      ativo: itemDoc.disabled === 0,
      imagem: itemDoc.image || null,
      descricao: itemDoc.description || null,
      marca: itemDoc.brand || null,
      modificado_em: itemDoc.modified || null,
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ produto, precos }),
    };
  } catch (err: any) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[product-detail]', err?.logMessage || err?.message || err);
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: code === 404 ? 'Produto não encontrado.' : 'Erro ao buscar produto.' }),
    };
  }
}
