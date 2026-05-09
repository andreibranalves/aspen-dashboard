// ── Imports ─────────────────────────────────────────────────────────────────
import { erpGetList, erpGetDoc, createHttpError } from './lib/erpnext.js';

// ── Constants ───────────────────────────────────────────────────────────────
const BRACKETS = [30, 100, 300, 500, 1000];

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fetch a single Pricing Rule by its title (SKU-bracket).
 * Returns { faixa: number, rate: number|null }.
 * rate is null if the rule does not exist.
 */
async function fetchBracketPrice(sku, bracket) {
  const title = `${sku}-${bracket}`;
  const rules = await erpGetList('Pricing Rule', {
    filters: [['title', '=', title]],
    limit: 1,
  });
  if (rules.length === 0) {
    return { faixa: bracket, rate: null };
  }
  // Fetch full doc to get the rate field
  const doc = await erpGetDoc('Pricing Rule', rules[0].name);
  return { faixa: bracket, rate: doc?.rate != null ? doc.rate : null };
}

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

  try {
    // Buscar Item por item_code
    let itemDoc;
    try {
      itemDoc = await erpGetDoc('Item', sku, {
        fields: ['item_code', 'item_name', 'item_group', 'stock_uom', 'disabled', 'image', 'description', 'brand', 'modified'],
      });
    } catch (err) {
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

    // Buscar precos de todas as faixas em paralelo
    const precos = await Promise.all(
      BRACKETS.map(bracket => fetchBracketPrice(sku, bracket))
    );

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
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[product-detail]', err?.logMessage || err?.message || err);
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.message || 'Erro ao buscar produto.' }),
    };
  }
}
