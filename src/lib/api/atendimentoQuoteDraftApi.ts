import { apiGet, apiPost } from '@/lib/api/api';

export interface AtendimentoQuoteDraft {
  demandId: string;
  quoteLeadId: string;
  crmDealId: string | null;
  conversationId: string;
  text: string;
  clientId: string | null;
  phone: string | null;
  name: string | null;
  destination: string;
}

export function prepareAtendimentoQuoteDraft(input: { conversationId: string; demandId: string; messageIds: string[] }) {
  return apiPost<AtendimentoQuoteDraft>('/atendimento-quote-draft', input);
}

export function fetchAtendimentoQuoteDraft(demandId: string) {
  return apiGet<AtendimentoQuoteDraft>(`/atendimento-quote-draft?demandId=${encodeURIComponent(demandId)}`);
}
