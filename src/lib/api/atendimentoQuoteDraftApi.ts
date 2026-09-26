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
  email: string | null;
  destination: string;
}

/** A value copied from one message the client sent. */
export interface ContactEvidence {
  value: string;
  messageId: string;
  at: string;
}

/** The client's own messages describing what to quote, copied verbatim. */
export interface ContactOrder {
  text: string;
  messageIds: string[];
  at: string;
}

export interface AtendimentoContact {
  conversationId: string;
  name: ContactEvidence | null;
  company: ContactEvidence | null;
  order: ContactOrder | null;
  email: ContactEvidence | null;
  /** WhatsApp number of the conversation; null while the identity is in conflict. */
  phone: string | null;
  profileName: string | null;
  /** The model read failed; a null name, company or order then means "not read", not "not found". */
  modelUnavailable: boolean;
}

export interface AtendimentoQuoteContact {
  name: string;
  company: string;
  email: string;
  order: string;
}

export function extractAtendimentoContact(conversationId: string) {
  return apiPost<AtendimentoContact>('/atendimento-contact', { conversationId });
}

export function prepareAtendimentoQuoteDraft(input: { conversationId: string; demandId: string; contact: AtendimentoQuoteContact }) {
  return apiPost<AtendimentoQuoteDraft>('/atendimento-quote-draft', input);
}

export function fetchAtendimentoQuoteDraft(demandId: string) {
  return apiGet<AtendimentoQuoteDraft>(`/atendimento-quote-draft?demandId=${encodeURIComponent(demandId)}`);
}
