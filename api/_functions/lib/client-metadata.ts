// Shared client metadata normalization & validation for orcamento pipeline.
// Imported by orcamento.js. Uses erpnext.js for ERPNext calls and createHttpError.
//
// Usage:
//   import { normalizeLeadSource, validateLeadSource, normalizeCnpj, isValidCnpj,
//            normalizeAddressPayload, buildAddressPayload } from './client-metadata.js';

import { createHttpError, erpGetList } from './erpnext.js';

export interface AddressPayload {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
}

// ── Origem / Lead Source ─────────────────────────────────────────────────────

/** Canonical source list — must match frontend LEAD_SOURCES */
export const LEAD_SOURCES = ['Google Ads', 'Bríndice', 'Cliente recorrente'] as const;

export function normalizeLeadSource(value: unknown): string {
  const v = String(value || '').trim();
  if (!v) return '';
  // Busca accent + case-insensitive na lista canônica
  const normalize = (s: string): string =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const vKey = normalize(v);
  const found = (LEAD_SOURCES as readonly string[]).find((s) => normalize(s) === vKey);
  return found || v;
}

export function isValidLeadSource(value: unknown): boolean {
  const v = normalizeLeadSource(value);
  return v !== '' && (LEAD_SOURCES as readonly string[]).includes(v);
}

/**
 * Verifica se a origem existe nos registros do ERPNext (CRM Lead Source e UTM Source).
 * Retorna { crm: true/false, utm: true/false }.
 * Lança erro 409 se a origem não existir em NENHUM dos dois.
 */
export async function validateLeadSourceInErp(
  source: string
): Promise<{ crm: boolean; utm: boolean }> {
  if (!isValidLeadSource(source)) {
    throw createHttpError(400, `Origem "${source}" não é reconhecida.`);
  }

  let crm = false;
  let utm = false;

  try {
    const crmList = await erpGetList('CRM Lead Source', {
      filters: [['name', '=', source]],
      fields: ['name'],
      limit: 1,
    });
    crm = crmList.length > 0;
  } catch {
    // fallback — will be reported as missing
  }

  try {
    const utmList = await erpGetList('UTM Source', {
      filters: [['name', '=', source]],
      fields: ['name'],
      limit: 1,
    });
    utm = utmList.length > 0;
  } catch {
    // fallback
  }

  if (!crm && !utm) {
    throw createHttpError(
      409,
      `Origem "${source}" não existe no ERPNext em CRM Lead Source nem em UTM Source. Configure antes de criar o orçamento.`
    );
  }

  return { crm, utm };
}

// ── CNPJ ─────────────────────────────────────────────────────────────────────

export function onlyDigits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

export function normalizeCnpj(value: unknown): string {
  return onlyDigits(value).slice(0, 14);
}

export function isValidCnpj(value: unknown): boolean {
  const digits = normalizeCnpj(value);
  if (digits.length === 0) return true;
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const calc = (slice: string, weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) {
      sum += Number(slice[i]) * weights[i];
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calc(digits.slice(0, 12), w1);
  const d2 = calc(digits.slice(0, 13), w2);

  return d1 === Number(digits[12]) && d2 === Number(digits[13]);
}

// ── Endereço ─────────────────────────────────────────────────────────────────

export function normalizeAddressPayload(address: unknown): AddressPayload {
  if (!address || typeof address !== 'object') {
    return {
      cep: '',
      logradouro: '',
      numero: '',
      complemento: '',
      bairro: '',
      cidade: '',
      uf: '',
    };
  }
  const a = address as Record<string, unknown>;
  return {
    cep: onlyDigits(a.cep || ''),
    logradouro: String(a.logradouro || '').trim(),
    numero: String(a.numero || '').trim(),
    complemento: String(a.complemento || '').trim(),
    bairro: String(a.bairro || '').trim(),
    cidade: String(a.cidade || '').trim(),
    uf: String(a.uf || '')
      .trim()
      .toUpperCase(),
  };
}

export function hasMinimumAddressForErp(address: unknown): boolean {
  const a = normalizeAddressPayload(address);
  const hasLine1 = !!(a.logradouro || a.numero);
  return hasLine1 && !!a.cidade;
}

export function buildAddressPayload(opts: {
  address: unknown;
  nomeCliente: string;
  email: string;
  telefone: string;
  entityType: 'Customer' | 'Lead';
  entityId: string;
}): Record<string, unknown> {
  const { address, nomeCliente, email, telefone, entityType, entityId } = opts;
  const a = normalizeAddressPayload(address);

  // Linha 1: logradouro + numero
  const line1Parts = [a.logradouro];
  if (a.numero) line1Parts.push(a.numero);
  const address_line1 = line1Parts.filter(Boolean).join(', ');

  // Linha 2: bairro + complemento
  const line2Parts = [];
  if (a.bairro) line2Parts.push(a.bairro);
  if (a.complemento) line2Parts.push(a.complemento);
  const address_line2 = line2Parts.filter(Boolean).join(' - ') || undefined;

  const payload: Record<string, unknown> = {
    address_title: nomeCliente || entityId || 'Cliente',
    address_type: 'Billing',
    address_line1,
    city: a.cidade,
    country: 'Brazil',
    links: [{ link_doctype: entityType, link_name: entityId }],
  };

  if (address_line2) payload.address_line2 = address_line2;
  if (a.uf) payload.state = a.uf;
  if (a.cep) payload.pincode = a.cep;
  if (email) payload.email_id = email;
  if (telefone) payload.phone = telefone;

  return payload;
}
