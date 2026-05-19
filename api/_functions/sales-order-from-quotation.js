// POST /api/sales-order-from-quotation — convert a confirmed quotation into a
// confirmed Sales Order with dedup protection, auto-submit, and CRM update.

import { erpGetList, erpGetDoc, erpPost, erpCallMethod, createHttpError } from './lib/erpnext.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract a `.name` property from the response of a Frappe method call.
 * Frappe returns { message: { name: 'ORD-...' } } or similar shapes.
 */
function resolveDocName(mapped) {
  if (typeof mapped === 'string') return mapped;
  if (mapped?.name) return mapped.name;
  if (mapped?.data?.name) return mapped.data.name;
  if (mapped?.message?.name) return mapped.message.name;
  return null;
}

/**
 * Normalise the mapped doc so it has at least `doctype` and `items`.
 */
function normaliseMappedDoc(mapped) {
  // If the method returned the full doc directly
  if (mapped?.doctype) return mapped;
  // Sometimes Frappe wraps it in message.data
  if (mapped?.data?.doctype) return mapped.data;
  if (mapped?.message?.doctype) return mapped.message;
  return mapped;
}

/**
 * Try to update the CRM Deal linked to this quotation.  Never throws.
 * Returns `true` if the update succeeded, `false` otherwise.
 */
async function tryUpdateCrmDeal(quotationId, salesOrderName) {
  try {
    const deals = await erpGetList('CRM Deal', {
      filters: [['custom_quotation', '=', quotationId]],
      limit: 1,
      fields: ['name'],
    });

    if (!deals || deals.length === 0) {
      console.warn('[sales-order-from-quotation] Nenhum CRM Deal encontrado para', quotationId);
      return false;
    }

    const dealId = deals[0].name;

    // Attempt full update first (with custom_sales_order)
    try {
      await erpCallMethod('frappe.client.set_value', {
        doctype: 'CRM Deal',
        name: dealId,
        fieldname: {
          status: 'Pedido Fechado',
          custom_sales_order: salesOrderName,
        },
      });
      return true;
    } catch (fullErr) {
      // Fallback: status-only (custom_sales_order field may not exist)
      console.warn(
        '[sales-order-from-quotation] Falha ao atualizar deal com custom_sales_order, tentando apenas status:',
        fullErr?.logMessage || fullErr?.message || fullErr
      );
      await erpCallMethod('frappe.client.set_value', {
        doctype: 'CRM Deal',
        name: dealId,
        fieldname: {
          status: 'Pedido Fechado',
        },
      });
      return true;
    }
  } catch (err) {
    console.warn('[sales-order-from-quotation] CRM update failed:', err?.logMessage || err?.message || err);
    return false;
  }
}

// ── Dedup ────────────────────────────────────────────────────────────────────

/**
 * Check whether a Sales Order already exists for this quotation.
 *
 * Returns { alreadyExists: boolean, existingOrder: object|null }
 */
async function checkDuplicate(quotationId) {
  try {
    // Preferred path: query child table (Sales Order Item) for prevdoc_docname
    const items = await erpGetList('Sales Order Item', {
      filters: [['prevdoc_docname', '=', quotationId]],
      fields: ['parent'],
      limit: 10,
    });

    if (items && items.length > 0) {
      const parentName = items[0].parent;
      const existing = await erpGetDoc('Sales Order', parentName);
      if (existing && existing.docstatus !== 2) {
        return { alreadyExists: true, existingOrder: existing };
      }
      // docstatus === 2 is cancelled — allow re-conversion
      return { alreadyExists: false, existingOrder: null };
    }

    return { alreadyExists: false, existingOrder: null };
  } catch (_err) {
    // Fallback: child table query may fail (field missing, permission issue)
    // Search recent Sales Orders and check items manually
    console.warn(
      '[sales-order-from-quotation] Child-table query failed, using fallback:',
      _err?.logMessage || _err?.message || _err
    );
  }

  // ── Fallback ──────────────────────────────────────────────────────────
  try {
    const recentOrders = await erpGetList('Sales Order', {
      fields: ['name', 'docstatus', 'transaction_date'],
      filters: [['docstatus', '!=', 2]],
      order_by: 'transaction_date desc',
      limit: 20,
    });

    for (const order of recentOrders) {
      try {
        const fullOrder = await erpGetDoc('Sales Order', order.name, {
          fields: ['name', 'docstatus', 'items'],
        });
        if (!fullOrder) continue;

        const items = fullOrder.items || [];
        const hasMatch = items.some(
          item => item.prevdoc_docname === quotationId
        );
        if (hasMatch && fullOrder.docstatus !== 2) {
          return { alreadyExists: true, existingOrder: fullOrder };
        }
      } catch {
        // Skip orders that can't be loaded
      }
    }

    return { alreadyExists: false, existingOrder: null };
  } catch (err) {
    console.warn('[sales-order-from-quotation] Fallback dedup also failed:', err?.logMessage || err?.message || err);
    return { alreadyExists: false, existingOrder: null };
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  try {
    // ── 1. Validate payload ──────────────────────────────────────────────
    const quotationId = payload.quotation_id;
    if (!quotationId) {
      throw createHttpError(400, 'Informe o orçamento para gerar o pedido de venda.');
    }

    // ── 2. Load Quotation ────────────────────────────────────────────────
    const quotation = await erpGetDoc('Quotation', quotationId);
    if (!quotation) {
      throw createHttpError(404, 'Orçamento não encontrado.');
    }

    // Block cancelled / lost quotations
    const blockedStatuses = ['Cancelled', 'Lost', 'Expired'];
    if (quotation.docstatus === 2 || blockedStatuses.includes(quotation.status)) {
      throw createHttpError(
        400,
        'Este orçamento não pode ser convertido em pedido de venda.'
      );
    }

    // ── 3. Dedup check ───────────────────────────────────────────────────
    const { alreadyExists, existingOrder } = await checkDuplicate(quotationId);
    if (alreadyExists && existingOrder) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          quotation_id: quotationId,
          sales_order_id: existingOrder.name,
          sales_order_status: existingOrder.status,
          docstatus: existingOrder.docstatus,
          already_exists: true,
          crm_updated: false,
        }),
      };
    }

    // ── 4. Submit quotation if draft ─────────────────────────────────────
    if (quotation.docstatus === 0) {
      try {
        await erpCallMethod('frappe.client.submit', { doc: quotation });
      } catch (submitErr) {
        throw createHttpError(
          400,
          'Não foi possível confirmar o orçamento antes de gerar o pedido. Revise os itens e tente novamente.',
          `Falha ao submeter cotação ${quotationId}: ${submitErr?.logMessage || submitErr?.message || submitErr}`
        );
      }
    }

    // ── 5. Call native mapper ────────────────────────────────────────────
    let mapped;
    try {
      mapped = await erpCallMethod(
        'erpnext.selling.doctype.quotation.quotation.make_sales_order',
        { source_name: quotationId }
      );
    } catch (mapErr) {
      throw createHttpError(
        400,
        'Não foi possível converter o orçamento em pedido de venda. Verifique os itens e tente novamente.',
        `Falha ao mapear cotação ${quotationId} para pedido: ${mapErr?.logMessage || mapErr?.message || mapErr}`
      );
    }

    const normalisedMapped = normaliseMappedDoc(mapped);

    // ── 6. Save Sales Order ──────────────────────────────────────────────
    let salesOrder;
    const existingName = resolveDocName(normalisedMapped) || normalisedMapped?.name;

    if (existingName) {
      // The mapper returned an already-saved doc — load it fresh
      salesOrder = await erpGetDoc('Sales Order', existingName);
      if (!salesOrder) {
        throw createHttpError(500, 'Erro ao recuperar pedido de venda salvo.');
      }
    } else if (normalisedMapped?.doctype === 'Sales Order' && normalisedMapped?.items) {
      // In-memory doc: create via POST — ensure delivery_date is set
      if (!normalisedMapped.delivery_date) {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        normalisedMapped.delivery_date = d.toISOString().slice(0, 10);
      }
      salesOrder = await erpPost('Sales Order', normalisedMapped);
    } else {
      throw createHttpError(
        500,
        'Erro ao processar o pedido de venda. Formato inesperado da conversão.'
      );
    }

    // ── 7. Submit Sales Order if draft ───────────────────────────────────
    if (salesOrder.docstatus === 0 || salesOrder.docstatus === undefined) {
      try {
        await erpCallMethod('frappe.client.submit', { doc: salesOrder });
      } catch (soSubmitErr) {
        throw createHttpError(
          400,
          'Não foi possível confirmar o pedido de venda automaticamente.',
          `Falha ao submeter pedido ${salesOrder.name}: ${soSubmitErr?.logMessage || soSubmitErr?.message || soSubmitErr}`
        );
      }
      // Reload to get fresh status
      salesOrder = await erpGetDoc('Sales Order', salesOrder.name);
    }

    const finalName = salesOrder?.name || salesOrder?.data?.name || '(unknown)';

    // ── 8. Update CRM Deal (best-effort) ─────────────────────────────────
    const crmUpdated = await tryUpdateCrmDeal(quotationId, finalName);

    // ── 9. Return response ───────────────────────────────────────────────
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        quotation_id: quotationId,
        sales_order_id: finalName,
        sales_order_status: salesOrder?.status || 'Submitted',
        docstatus: salesOrder?.docstatus ?? 1,
        already_exists: false,
        crm_updated: crmUpdated,
      }),
    };
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[sales-order-from-quotation]', err?.logMessage || err?.message || err);
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.statusCode ? err.message : 'Erro interno.' }),
    };
  }
}
