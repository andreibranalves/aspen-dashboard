// api/_functions/lib/quote-pipeline.ts
// Quotation pipeline orchestrator — coordinates customer resolution,
// pricing, quotation creation, deal upsert, and response assembly.
// Extracted from orcamento.js — no behavior changes.

import type { FunctionEvent } from '../../_lib/types.js';
import { createHttpError, erpGetDoc, erpPost } from './erpnext.js';
import {
  normalizeLeadSource,
  isValidLeadSource,
  validateLeadSourceInErp,
  normalizeCnpj,
  isValidCnpj,
  normalizeAddressPayload,
} from './client-metadata.js';
import { getUrgentRate, getRate } from '../pricing.js';
import { resolveParty, resolveAddress } from './customer-resolution.js';
import { findDeal, upsertDeal } from './deal-resolution.js';
import { buildQuoteResponse } from './quote-response.js';

const ERPNEXT_BASE = 'https://aspenestamparia.l.frappe.cloud';
const ERPNEXT_TOKEN = process.env.ERPNEXT_TOKEN;

async function localGetRate(itemCode: string, qty: number): Promise<number> {
  return getRate(itemCode, qty, ERPNEXT_BASE, ERPNEXT_TOKEN || '') as Promise<number>;
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

export interface ExtractedData {
  nome: string;
  email?: string;
  telefone?: string;
  urgente?: boolean;
  origem?: string;
  cnpj?: string;
  endereco?: Record<string, unknown>;
  items: Array<{
    item_code: string;
    qty: number;
    rate?: number;
    manual_rate?: boolean;
  }>;
  prazo_producao?: string;
  observacoes?: string;
}

/**
 * Run the full quotation pipeline: validate → resolve party → price → create → respond.
 */
export async function runQuotePipeline(
  event: FunctionEvent,
  extracted: ExtractedData
): Promise<Record<string, unknown>> {
  const warnings: Array<{ code: string; message: string }> = [];

  // ── 0. Validate metadata ──
  const origem = normalizeLeadSource(extracted.origem || '');
  if (!origem) {
    throw createHttpError(
      400,
      'Origem do lead é obrigatória. Selecione uma origem antes de criar o orçamento.'
    );
  }
  if (!isValidLeadSource(origem)) {
    throw createHttpError(
      400,
      `Origem "${extracted.origem}" não é reconhecida. Use uma das origens disponíveis.`
    );
  }

  // Validate origin exists in ERPNext
  const { utm: utmSourceExists } = await validateLeadSourceInErp(origem);
  if (!utmSourceExists) {
    warnings.push({
      code: 'utm_source_missing',
      message: `Origem "${origem}" salva no CRM, mas UTM Source não estava disponível no ERPNext.`,
    });
  }

  // CNPJ validation
  const cnpj = normalizeCnpj(extracted.cnpj || '');
  if (cnpj && !isValidCnpj(cnpj)) {
    throw createHttpError(
      400,
      'CNPJ informado é inválido. Verifique os dígitos ou deixe em branco.'
    );
  }

  // Address normalization
  const endereco = normalizeAddressPayload(extracted.endereco);

  // ── 1. Resolve party (Customer/Lead + Contact) ──
  const party = await resolveParty({
    nome: extracted.nome,
    email: extracted.email || '',
    telefone: extracted.telefone || '',
    cnpj,
    origem,
    utmSourceExists,
  });

  const {
    entityId,
    entityType,
    contactId,
    customerIsNew,
    nomeCliente,
    phoneFormatted: telefone,
    emailNormalized: email,
  } = party;

  // ── 2. Price items ──
  let items: Array<{
    item_code: string;
    qty: number;
    rate: number;
    manual_rate?: boolean;
    _rateManual?: boolean;
  }> = (extracted.items || []).map((item) => ({
    item_code: item.item_code,
    qty: item.qty,
    rate: item.rate || 0,
    manual_rate: item.manual_rate === true,
  }));
  items = items.filter((item) => item.item_code && item.qty > 0);
  if (items.length === 0) {
    throw createHttpError(400, 'Nenhum item válido informado para criar o orçamento.');
  }

  const urgente = extracted.urgente || false;

  for (const item of items) {
    const isManualRate = item.manual_rate === true;
    if (!isManualRate) {
      item.rate = await localGetRate(item.item_code, item.qty);
    }
    if (urgente && !isManualRate) {
      item.rate = getUrgentRate(item.rate);
    }
  }

  items = items.map(({ manual_rate, ...item }) => ({
    ...item,
    _rateManual: manual_rate,
  })) as Array<{ item_code: string; qty: number; rate: number; _rateManual?: boolean }>;

  // ── 3. Resolve address ──
  const addrResult = await resolveAddress({
    endereco: endereco as unknown as Record<string, string>,
    nomeCliente,
    email,
    telefone,
    entityType,
    entityId,
  });

  const { addressId } = addrResult;
  warnings.push(...addrResult.warnings);

  // ── 4. Find existing deal ──
  const dealId = await findDeal({
    email,
    nomeOriginal: extracted.nome.trim(),
    nomeCliente,
  });

  // ── 5. Create quotation ──
  const hoje = new Date().toISOString().slice(0, 10);
  const validade = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);

  const prazo = extracted.prazo_producao?.trim() || '';
  const observacoes = extracted.observacoes?.trim() || '';
  const remarksParts = [`Contato: ${nomeCliente} | ${email} | ${telefone}`];
  if (urgente) remarksParts.push('URGENTE');
  if (observacoes) remarksParts.push(`Obs: ${observacoes}`);
  if (origem) remarksParts.push(`Origem: ${origem}`);

  const quotePayload: Record<string, unknown> = {
    quotation_to: entityType,
    party_name: entityId,
    customer_name: nomeCliente,
    transaction_date: hoje,
    valid_till: validade,
    selling_price_list: 'Standard Selling',
    currency: 'BRL',
    exchange_rate: 1,
    items,
    remarks: remarksParts.join(' | '),
    ignore_pricing_rule: 1,
  };
  if (prazo) quotePayload.custom_prazo_producao = prazo;
  if (email) quotePayload.contact_email = email;
  if (telefone) quotePayload.contact_mobile = telefone;
  if (addressId) {
    quotePayload.customer_address = addressId;
    quotePayload.shipping_address_name = addressId;
  }
  if (utmSourceExists) {
    quotePayload.utm_source = origem;
  }

  const q = await erpPost('Quotation', quotePayload);
  const quotationId = q.name as string;
  const savedQuotation = await erpGetDoc('Quotation', quotationId);
  const savedItems = (savedQuotation?.items || items) as Array<{
    item_code: string;
    qty: number;
    rate: number;
  }>;

  // ── 6. Upsert CRM Deal ──
  const finalDealId = await upsertDeal({
    dealId,
    nomeCliente,
    origem,
    email,
    telefone,
    contactId,
    quotationId,
    hoje,
    savedItems,
  });

  // ── 7. Build response ──
  return buildQuoteResponse({
    event: event as unknown as import('./quote-response.js').VercelEventLike,
    quotationId,
    dealId: finalDealId,
    entityId,
    entityType,
    customerIsNew,
    nomeCliente,
    urgente,
    savedItems,
    origem,
    warnings,
  });
}
