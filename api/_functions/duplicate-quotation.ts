// POST /api/duplicate-quotation — Duplicates a quotation in ERPNext.
import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
//
// Body: { quotation_id: "ORC-20261368" }
// Returns: { success: true, new_id: "ORC-20261369" }

import { erpGetDoc, erpPost, createHttpError } from './lib/erpnext.js';

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const { quotation_id } = payload;
  if (!quotation_id || typeof quotation_id !== 'string' || !quotation_id.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'ID do orçamento é obrigatório.' }) };
  }

  try {
    // 1. Fetch source quotation
    const src = await erpGetDoc('Quotation', quotation_id);
    if (!src) {
      throw createHttpError(404, 'Orçamento não encontrado.', `[duplicate-quotation] not found: ${quotation_id}`);
    }

    // 2. Build items array (strip name/parent fields)
    const items = (src.items || []).map(item => ({
      item_code: item.item_code,
      item_name: item.item_name,
      description: item.description || '',
      qty: item.qty,
      uom: item.uom || item.stock_uom || 'und',
      rate: item.rate,
    }));

    if (items.length === 0) {
      throw createHttpError(400, 'Orçamento sem itens não pode ser duplicado.', '[duplicate-quotation] no items');
    }

    // 3. Create new quotation
    const newQuotation = await erpPost('Quotation', {
      quotation_to: src.quotation_to || 'Lead',
      party_name: src.party_name,
      customer_name: src.customer_name,
      title: src.title || src.customer_name || 'Cópia',
      currency: src.currency || 'BRL',
      selling_price_list: src.selling_price_list || 'Standard Selling',
      transaction_date: new Date().toISOString().split('T')[0],
      remarks: src.remarks || '',
      ...(src.utm_source ? { utm_source: src.utm_source } : {}),
      ...(src.contact_email ? { contact_email: src.contact_email } : {}),
      ...(src.contact_mobile ? { contact_mobile: src.contact_mobile } : {}),
      ...(src.customer_address ? { customer_address: src.customer_address } : {}),
      items,
      ignore_pricing_rule: 1,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        new_id: newQuotation.name,
      }),
    };
  } catch (err: any) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[duplicate-quotation]', err?.logMessage || err?.message || err);
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.statusCode ? err.message : 'Erro interno ao duplicar orçamento.' }),
    };
  }
}
