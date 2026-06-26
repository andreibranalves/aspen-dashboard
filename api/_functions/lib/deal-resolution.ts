// api/_functions/lib/deal-resolution.ts
// CRM Deal resolution for the quotation pipeline.
// Extracted from orcamento.js — no behavior changes.

import { erpGetList, erpPost, erpPut } from './erpnext.js';

// ── Deal lookup ──────────────────────────────────────────────────────────────

export interface FindDealOptions {
  email: string;
  nomeOriginal: string;
  nomeCliente: string;
}

/**
 * Find an existing CRM Deal by email or lead_name.
 */
export async function findDeal(opts: FindDealOptions): Promise<string | null> {
  const { email, nomeOriginal, nomeCliente } = opts;
  let dealId: string | null = null;

  // Try by email first
  if (email) {
    const dealData = await erpGetList('CRM Deal', {
      filters: [['email', '=', email]],
    });
    if (dealData.length > 0) dealId = dealData[0].name as string;
  }

  // Try by lead_name (both raw and sanitized)
  if (!dealId) {
    for (const nomeBusca of [nomeOriginal, nomeCliente]) {
      const dd = await erpGetList('CRM Deal', {
        filters: [['lead_name', '=', nomeBusca]],
      });
      if (dd.length > 0) {
        dealId = dd[0].name as string;
        break;
      }
    }
  }

  return dealId;
}

// ── Deal upsert ──────────────────────────────────────────────────────────────

export interface SavedQuoteItem {
  item_code: string;
  qty: number;
  rate: number;
}

export interface UpsertDealOptions {
  dealId: string | null;
  nomeCliente: string;
  origem: string;
  email: string;
  telefone: string;
  contactId: string | null;
  quotationId: string;
  hoje: string;
  savedItems: SavedQuoteItem[];
}

/**
 * Create or update a CRM Deal linked to the quotation.
 */
export async function upsertDeal(opts: UpsertDealOptions): Promise<string> {
  const { dealId, nomeCliente, origem, email, telefone, contactId, quotationId, hoje, savedItems } =
    opts;

  const rawNextStep = savedItems.map((i: SavedQuoteItem) => `${i.qty}x ${i.item_code}`).join(', ');
  const MAX_NEXT_STEP = 140;
  const nextStep =
    rawNextStep.length > MAX_NEXT_STEP
      ? rawNextStep.substring(0, MAX_NEXT_STEP - 3) + '...'
      : rawNextStep;

  let resultId = dealId;

  if (resultId) {
    const upd: Record<string, unknown> = {
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
    await erpPut('CRM Deal', resultId, upd);
  } else {
    const dp: Record<string, unknown> = {
      lead_name: nomeCliente,
      source: origem,
      status: 'Orcamento Enviado',
      currency: 'BRL',
      exchange_rate: 1,
      custom_quotation: quotationId,
      custom_quotation_sent_date: hoje,
      custom_follow_up_stage: 0,
      next_step: nextStep,
      products: savedItems.map((i: SavedQuoteItem) => ({
        product_name: i.item_code,
        qty: i.qty,
        rate: i.rate,
      })),
    };
    if (email) dp.email = email;
    if (contactId) dp.contacts = [{ contact: contactId, is_primary: 1 }];
    const d = await erpPost('CRM Deal', dp);
    resultId = d.name as string;
  }

  return resultId!;
}
