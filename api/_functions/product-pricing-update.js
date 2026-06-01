// ── Imports ─────────────────────────────────────────────────────────────────
import { erpGetList, erpGetDoc, erpPost, erpPut, createHttpError } from './lib/erpnext.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Upsert a single Pricing Rule bracket for a given SKU.
 * Returns { faixa, rate, status, rule_name }.
 */
async function upsertBracket(sku, faixa, rate) {
  const title = `${sku}-${faixa}`;

  // Buscar Pricing Rule existente pelo titulo
  const existing = await erpGetList('Pricing Rule', {
    filters: [['title', '=', title]],
    limit: 1,
  });

  if (existing.length > 0) {
    // Atualizar regra existente
    const ruleName = existing[0].name;
    try {
      await erpPut('Pricing Rule', ruleName, { rate });
      return { faixa, rate, status: 'atualizado', rule_name: ruleName };
    } catch (err) {
      console.error('[product-pricing-update]', `Erro ao atualizar ${title}:`, err?.logMessage || err?.message || err);
      return { faixa, rate, status: 'erro', rule_name: ruleName, error: err?.message || 'Erro ao atualizar.' };
    }
  }

  // Criar nova Pricing Rule
  try {
    const created = await erpPost('Pricing Rule', {
      title,
      apply_on: 'Item Code',
      rate,
      selling: 1,
      price_or_product_discount: 'Price',
      rate_or_discount: 'Rate',
      items: [{ item_code: sku }],
    });
    return { faixa, rate, status: 'criado', rule_name: created?.name || title };
  } catch (err) {
    console.error('[product-pricing-update]', `Erro ao criar ${title}:`, err?.logMessage || err?.message || err);
    return { faixa, rate, status: 'erro', rule_name: null, error: err?.message || 'Erro ao criar.' };
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.httpMethod !== 'PUT') {
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

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'JSON inválido.' }),
    };
  }

  const { precos } = payload;

  if (!Array.isArray(precos) || precos.length === 0) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Preços deve ser um array com ao menos uma faixa.' }),
    };
  }

  // Validar payload
  for (const p of precos) {
    if (!p.faixa || typeof p.rate !== 'number' || p.rate < 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Faixa inválida ou rate ausente em: ${JSON.stringify(p)}` }),
      };
    }
  }

  try {
    // Verificar que o produto existe
    let item;
    try {
      item = await erpGetDoc('Item', sku);
    } catch (err) {
      if (err?.logMessage?.includes('404') || err?.message?.includes('404')) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Produto não encontrado.' }),
        };
      }
      throw err;
    }

    if (!item) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Produto não encontrado.' }),
      };
    }

    // Upsert cada faixa (sequencial para evitar race conditions no ERPNext)
    const resultados = [];
    for (const p of precos) {
      const result = await upsertBracket(sku, p.faixa, p.rate);
      resultados.push(result);
    }

    const erros = resultados.filter(r => r.status === 'erro');
    const sucesso = resultados.length - erros.length;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: erros.length === 0,
        sku,
        atualizados: sucesso,
        erros: erros.length,
        resultados,
      }),
    };
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[product-pricing-update]', err?.logMessage || err?.message || err);
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.message || 'Erro ao atualizar preços.' }),
    };
  }
}
