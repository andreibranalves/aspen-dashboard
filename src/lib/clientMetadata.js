// ── Origem / Lead Source ─────────────────────────────────────────────────────

export const LEAD_SOURCES = [
  { value: 'Google Ads', label: 'Google Ads' },
  { value: 'Bríndice', label: 'Bríndice' },
  { value: 'Cliente recorrente', label: 'Cliente recorrente' },
];

const accInsensitive = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function normalizeLeadSource(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  const key = accInsensitive(v);
  const found = LEAD_SOURCES.find(s => accInsensitive(s.value) === key);
  return found ? found.value : v;
}

export const DEFAULT_LEAD_SOURCE = 'Google Ads';

export function isValidLeadSource(value) {
  if (!value) return false;
  const key = accInsensitive(value);
  return LEAD_SOURCES.some(s => accInsensitive(s.value) === key);
}

export function getLeadSourceLabel(value) {
  if (!value) return '';
  const key = accInsensitive(value);
  const src = LEAD_SOURCES.find(s => accInsensitive(s.value) === key);
  return src ? src.label : value || '';
}

// ── CNPJ ─────────────────────────────────────────────────────────────────────

export function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Normaliza CNPJ para 14 dígitos ou string vazia.
 * Remove pontuação e espaços.
 */
export function normalizeCnpj(value) {
  return onlyDigits(value).slice(0, 14);
}

/**
 * Valida dígitos verificadores do CNPJ.
 * Aceita string vazia (CNPJ opcional).
 * Retorna true se vazio, ou true/false conforme validade dos dígitos.
 */
export function isValidCnpj(value) {
  const digits = normalizeCnpj(value);
  if (digits.length === 0) return true; // opcional
  if (digits.length !== 14) return false;

  // Rejeita CNPJs com todos os dígitos iguais
  if (/^(\d)\1{13}$/.test(digits)) return false;

  // Cálculo dos dígitos verificadores
  const calc = (slice, weights) => {
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

/**
 * Formata CNPJ para exibição: 00.000.000/0000-00
 */
export function formatCnpj(value) {
  const digits = normalizeCnpj(value);
  if (digits.length !== 14) return value;
  return digits.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    '$1.$2.$3/$4-$5'
  );
}

// ── Endereço ─────────────────────────────────────────────────────────────────

export const EMPTY_ADDRESS = {
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
};

/**
 * Normaliza um objeto de endereço, garantindo todas as chaves e valores string.
 */
export function normalizeAddress(address) {
  if (!address || typeof address !== 'object') return { ...EMPTY_ADDRESS };
  return {
    cep: onlyDigits(address.cep || ''),
    logradouro: String(address.logradouro || '').trim(),
    numero: String(address.numero || '').trim(),
    complemento: String(address.complemento || '').trim(),
    bairro: String(address.bairro || '').trim(),
    cidade: String(address.cidade || '').trim(),
    uf: String(address.uf || '').trim().toUpperCase(),
  };
}

/**
 * Retorna true se ao menos um campo do endereço está preenchido.
 */
export function hasAnyAddressField(address) {
  const a = normalizeAddress(address);
  return Object.values(a).some(v => v.length > 0);
}

/**
 * Retorna true se o endereço tem dados mínimos para criar Address no ERPNext:
 * logradouro + numero, cidade, e país (sempre Brasil).
 */
export function hasMinimumAddressForErp(address) {
  const a = normalizeAddress(address);
  return !!(a.logradouro || a.numero) && !!a.cidade;
}

/**
 * Resumo de endereço para exibição compacta.
 */
export function formatAddressSummary(address) {
  const a = normalizeAddress(address);
  const line1 = [a.logradouro, a.numero].filter(Boolean).join(', ');
  const line2 = [a.bairro, a.cidade, a.uf].filter(Boolean).join(' - ');
  if (!line1 && !line2) return '';
  return [line1, line2].filter(Boolean).join(' · ');
}
