// api/_functions/lib/deal-resolution.js
// CRM Deal resolution for the quotation pipeline.
// Extracted from orcamento.js — no behavior changes.

import { erpGetList, erpPost, erpPut } from './erpnext.js';

// ── Deal lookup ──────────────────────────────────────────────────────────────

/**
 * Find an existing CRM Deal by email or lead_name.
 *
 * @param {object} opts
 * @param {string} opts.email - normalized client email (may be empty)
 * @param {string} opts.nomeOriginal - original (raw) client name
 * @param {string} opts.nomeCliente - sanitized client name
 * @returns {Promise<string|null>} deal ID or null
 */
export async function findDeal({ email, nomeOriginal, nomeCliente }) {
  let dealId = null;

  // Try by email first
  if (email) {
    const dealData = await erpGetList('CRM Deal', {
      filters: [['email', '=', email]],
    });
    if (dealData.length > 0) dealId = dealData[0].name;
  }

  // Try by lead_name (both raw and sanitized)
  if (!dealId) {
    for (const nomeBusca of [nomeOriginal, nomeCliente]) {
      const dd = await erpGetList('CRM Deal', {
        filters: [['lead_name', '=', nomeBusca]],
      });
      if (dd.length > 0) {
        dealId = dd[0].name;
        break;
      }
    }
  }

  return dealId;
}

// ── Deal upsert ──────────────────────────────────────────────────────────────

/**
 * Create or update a CRM Deal linked to the quotation.
 *
 * @param {object} opts
 * @param {string|null} opts.dealId - existing deal ID or null
 * @param {string} opts.nomeCliente - sanitized client name
 * @param {string} opts.origem - validated lead source
 * @param {string} opts.email - normalized email
 * @param {string} opts.telefone - formatted phone
 * @param {string|null} opts.contactId - ERPNext Contact ID
 * @param {string} opts.quotationId - new quotation name
 * @param {string} opts.hoje - today's date (ISO YYYY-MM-DD)
 * @param {Array} opts.savedItems - quotation items [{item_code, qty, rate}]
 * @returns {Promise<string>} deal ID
 */
export async function upsertDeal({
  dealId,
  nomeCliente,
  origem,
  email,
  telefone,
  contactId,
  quotationId,
  hoje,
  savedItems,
}) {
  const rawNextStep = savedItems.map((i) => `${i.qty}x ${i.item_code}`).join(', ');
  const MAX_NEXT_STEP = 140;
  const nextStep =
    rawNextStep.length > MAX_NEXT_STEP
      ? rawNextStep.substring(0, MAX_NEXT_STEP - 3) + '...'
      : rawNextStep;

  if (dealId) {
    const upd = {
      status: 'Orcamento Enviado',
      source: origem,
      custom_quotation: quotationId,
      custom_quotation_sent_date: hoje,
      custom_follow_up_stage: 0,
      next_step: nextStep,
    };
    if (email) upd.email = email;
    if (telefone) upd.mobile_no = telefone;
    if (contactId) upd.contacts = [{ contact: contactId, is_primary: 1 }];
    await erpPut('CRM Deal', dealId, upd);
  } else {
    const dp = {
      lead_name: nomeCliente,
      source: origem,
      status: 'Orcamento Enviado',
      currency: 'BRL',
      exchange_rate: 1,
      custom_quotation: quotationId,
      custom_quotation_sent_date: hoje,
      custom_follow_up_stage: 0,
      next_step: nextStep,
      products: savedItems.map((i) => ({
        product_name: i.item_code,
        qty: i.qty,
        rate: i.rate,
      })),
    };
    if (email) dp.email = email;
    if (contactId) dp.contacts = [{ contact: contactId, is_primary: 1 }];
    const d = await erpPost('CRM Deal', dp);
    dealId = d.name;
  }

  return dealId;
}
