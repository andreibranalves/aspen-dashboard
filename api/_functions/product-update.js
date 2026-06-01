// ── Imports ─────────────────────────────────────────────────────────────────
import { erpGetDoc, erpPut, createHttpError } from './lib/erpnext.js';
import { saveProductPricing } from './product-pricing.js';

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
    payload = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'JSON inválido.' }),
    };
  }

  const { nome, descricao, categoria, unidade, marca, ativo, precos } = payload;
  const hasMetadata = nome != null || descricao != null || categoria != null || unidade != null || marca != null || ativo != null;
  const hasPricing = Array.isArray(precos) && precos.length > 0;

  if (!hasMetadata && !hasPricing) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Nenhum campo para atualizar.' }),
    };
  }

  try {
    // Verify item exists
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

    let metadataResult = null;
    let pricingResult = null;

    // ── Update metadata ──
    if (hasMetadata) {
      const updateFields = {};
      if (nome != null) updateFields.item_name = nome;
      if (descricao != null) updateFields.description = descricao;
      if (categoria != null) updateFields.item_group = categoria;
      if (unidade != null) updateFields.stock_uom = unidade;
      if (marca != null) updateFields.brand = marca;
      if (ativo != null) updateFields.disabled = ativo ? 0 : 1;

      try {
        await erpPut('Item', sku, updateFields);
        metadataResult = { atualizado: true, campos: Object.keys(updateFields) };
      } catch (err) {
        console.error('[product-update]', `Erro ao atualizar metadata de ${sku}:`, err?.logMessage || err?.message || err);
        return {
          statusCode: err?.statusCode || 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Erro ao atualizar dados do produto.' }),
        };
      }
    }

    // ── Update pricing ──
    if (hasPricing) {
      try {
        pricingResult = await saveProductPricing(sku, precos);
      } catch (err) {
        console.error('[product-update]', `Erro ao atualizar preços de ${sku}:`, err?.logMessage || err?.message || err);
        return {
          statusCode: err?.statusCode || 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Erro ao atualizar preços.' }),
        };
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        sku,
        metadata: metadataResult,
        pricing: pricingResult,
      }),
    };
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[product-update]', err?.logMessage || err?.message || err);
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Erro ao atualizar produto.' }),
    };
  }
}
