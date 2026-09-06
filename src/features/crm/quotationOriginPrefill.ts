export interface QuotationOriginPrefill {
  quoteLeadId: string;
  crmDealId: string;
  leadName: string;
  email: string;
  telefone: string;
  source: string;
}

const STORAGE_KEY = 'aspen_quotation_origin_prefill';

export function storeQuotationOriginPrefill(prefill: QuotationOriginPrefill): void {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(prefill));
}

export function loadQuotationOriginPrefill(): QuotationOriginPrefill | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || 'null') as Partial<QuotationOriginPrefill> | null;
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    if (!value || value.quoteLeadId !== params.get('quoteLeadId') || value.crmDealId !== params.get('crmDealId')) return null;
    return {
      quoteLeadId: value.quoteLeadId,
      crmDealId: value.crmDealId,
      leadName: String(value.leadName || ''),
      email: String(value.email || ''),
      telefone: String(value.telefone || ''),
      source: String(value.source || ''),
    };
  } catch {
    return null;
  }
}

export function clearQuotationOriginPrefill(): void {
  window.sessionStorage.removeItem(STORAGE_KEY);
}
