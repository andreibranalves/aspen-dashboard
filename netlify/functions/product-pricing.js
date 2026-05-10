// ── Imports ─────────────────────────────────────────────────────────────────
import { erpGetList, erpGetDoc, erpPost, erpPut } from './lib/erpnext.js';
import { getUrgentRate } from './pricing.js';

// ── Constants ───────────────────────────────────────────────────────────────
export const BRACKETS = [30, 100, 300, 500, 1000];
const STANDARD_SELLING = 'Standard Selling';

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchPricingRuleByTitle(title) {
  const rules = await erpGetList('Pricing Rule', {
    fields: ['name', 'title'],
    filters: [['title', '=', title]],
    limit: 1,
  });

  if (!rules.length) return null;

  const doc = await erpGetDoc('Pricing Rule', rules[0].name);
  const rate = doc?.rate != null ? Number(doc.rate) : null;
  if (rate == null || Number.isNaN(rate)) return null;

  return {
    rate,
    rule_name: doc?.name || rules[0].name,
    title: doc?.title || title,
  };
}

async function fetchItemPrice(sku) {
  const prices = await erpGetList('Item Price', {
    fields: ['name', 'item_code', 'price_list', 'price_list_rate'],
    filters: [
      ['item_code', '=', sku],
      ['price_list', '=', STANDARD_SELLING],
    ],
    order_by: 'modified desc',
    limit: 1,
  });

  const price = prices[0];
  const rate = price?.price_list_rate != null ? Number(price.price_list_rate) : null;
  if (rate == null || Number.isNaN(rate)) return null;

  return {
    rate,
    item_price_name: price.name,
    price_list: price.price_list || STANDARD_SELLING,
  };
}

function formatPriceRow(faixa, rate, origem, detalhes = {}) {
  const hasPrice = rate != null && !Number.isNaN(Number(rate));
  const numericRate = hasPrice ? Number(rate) : null;

  return {
    faixa,
    qty: faixa,
    rate: numericRate,
    urgent_rate: hasPrice ? getUrgentRate(numericRate) : null,
    origem,
    origem_label: origem === 'pricing_rule_bracket'
      ? 'Pricing Rule por faixa'
      : origem === 'pricing_rule_sku'
        ? 'Pricing Rule do SKU'
        : origem === 'item_price'
          ? 'Item Price'
          : 'Não encontrado',
    status: hasPrice ? 'found' : 'missing',
    urgent_markup: 0.3,
    ...detalhes,
  };
}

export async function resolveProductPricing(sku) {
  const skuRule = await fetchPricingRuleByTitle(sku);
  const itemPrice = skuRule ? null : await fetchItemPrice(sku);

  const rows = [];

  for (const faixa of BRACKETS) {
    const bracketRule = await fetchPricingRuleByTitle(`${sku}-${faixa}`);

    if (bracketRule) {
      rows.push(formatPriceRow(faixa, bracketRule.rate, 'pricing_rule_bracket', {
        rule_name: bracketRule.rule_name,
        rule_title: bracketRule.title,
      }));
      continue;
    }

    if (skuRule) {
      rows.push(formatPriceRow(faixa, skuRule.rate, 'pricing_rule_sku', {
        rule_name: skuRule.rule_name,
        rule_title: skuRule.title,
      }));
      continue;
    }

    if (itemPrice) {
      rows.push(formatPriceRow(faixa, itemPrice.rate, 'item_price', {
        item_price_name: itemPrice.item_price_name,
        price_list: itemPrice.price_list,
      }));
      continue;
    }

    rows.push(formatPriceRow(faixa, null, 'missing'));
  }

  return rows;
}

async function upsertBracketPricingRule(sku, faixa, rate) {
  const title = `${sku}-${faixa}`;
  const existing = await erpGetList('Pricing Rule', {
    fields: ['name', 'title'],
    filters: [['title', '=', title]],
    limit: 1,
  });

  if (existing.length > 0) {
    const ruleName = existing[0].name;
    await erpPut('Pricing Rule', ruleName, { rate });
    return { faixa, rate, status: 'atualizado', origem: 'pricing_rule_bracket', rule_name: ruleName, rule_title: title };
  }

  const created = await erpPost('Pricing Rule', {
    title,
    apply_on: 'Item Code',
    item_code: sku,
    rate,
    selling: 1,
    price_or_product_discount: 'Price',
  });

  return { faixa, rate, status: 'criado', origem: 'pricing_rule_bracket', rule_name: created?.name || title, rule_title: title };
}

async function saveProductPricing(sku, precos) {
  const item = await erpGetDoc('Item', sku);
  if (!item) {
    const err = new Error('Produto não encontrado.');
    err.statusCode = 404;
    throw err;
  }

  const resultados = [];
  for (const p of precos) {
    const faixa = Number(p.faixa ?? p.qty);
    const rate = Number(p.rate);

    if (!BRACKETS.includes(faixa) || Number.isNaN(rate) || rate < 0) {
      resultados.push({ faixa: p.faixa, rate: p.rate, status: 'erro', error: 'Faixa ou preço inválido.' });
      continue;
    }

    try {
      resultados.push(await upsertBracketPricingRule(sku, faixa, rate));
    } catch (err) {
      console.error('[product-pricing]', `Erro ao salvar ${sku}-${faixa}:`, err?.logMessage || err?.message || err);
      resultados.push({ faixa, rate, status: 'erro', error: 'Erro ao salvar no ERPNext.' });
    }
  }

  const erros = resultados.filter(r => r.status === 'erro');
  return {
    success: erros.length === 0,
    sku,
    atualizados: resultados.length - erros.length,
    erros: erros.length,
    resultados,
  };
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event) {
  const params = event.queryStringParameters || {};
  const sku = (params.sku || '').trim();

  if (!sku) return json(400, { error: 'SKU é obrigatório.' });

  try {
    if (event.httpMethod === 'GET') {
      const precos = await resolveProductPricing(sku);
      return json(200, { sku, brackets: BRACKETS, precos });
    }

    if (event.httpMethod === 'POST' || event.httpMethod === 'PUT') {
      let payload;
      try { payload = JSON.parse(event.body || '{}'); }
      catch { return json(400, { error: 'JSON inválido.' }); }

      const { precos } = payload;
      if (!Array.isArray(precos) || precos.length === 0) {
        return json(400, { error: 'Preços deve ser um array com ao menos uma faixa.' });
      }

      const result = await saveProductPricing(sku, precos);
      return json(200, result);
    }

    return { statusCode: 405, body: 'Method Not Allowed' };
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[product-pricing]', err?.logMessage || err?.message || err);
    return json(code, { error: code === 404 ? 'Produto não encontrado.' : 'Erro ao processar preços do produto.' });
  }
}
