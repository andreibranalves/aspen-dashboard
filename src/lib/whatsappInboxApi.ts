import { apiGet, apiPatch, apiPost } from '@/lib/api';

export interface WhatsappAttachment {
  id: string;
  kind: 'image' | 'document' | 'audio';
  mimeType: string;
  fileName: string;
  mediaUrl: string;
  caption: string;
  origin: 'provider' | 'internal_generated';
  documentRole: 'quotation_pdf' | 'generic_document' | null;
  quotationId: string | null;
  leadId: string | null;
  customerId: string | null;
}

export type WhatsappConversationStatus =
  | 'new'
  | 'needs_quote'
  | 'incomplete'
  | 'quote_lead_created'
  | 'quotation_created'
  | 'waiting_customer'
  | 'closed'
  | 'ignored';

export interface WhatsappConversation {
  id: string;
  providerConversationId: string;
  remoteJid: string;
  canonicalPhone: string;
  phone: string;
  displayLabel: string;
  displayName: string;
  identityStatus: 'verified' | 'derived' | 'unresolved' | 'conflict';
  identitySource?: string | null;
  identityConfidence?: 'high' | 'medium' | 'low' | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  linkedLeadId?: string | null;
  linkedDealId?: string | null;
  linkedQuotationId?: string | null;
  status: WhatsappConversationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsappMessage {
  id: string;
  conversationId: string;
  providerMessageId: string;
  direction: 'inbound' | 'outbound';
  type: 'text' | 'image' | 'document' | 'audio' | 'unknown';
  body: string;
  mediaUrl: string;
  attachments?: WhatsappAttachment[];
  timestamp: string;
}

export interface WhatsappExtractionResult {
  conversationId: string;
  inputMessageIds: string[];
  extractedPayload: { orders?: unknown[]; [key: string]: unknown };
  confidence: number;
  missingFields: string[];
  createdAt: string;
}

export interface WhatsappCrmMatch {
  id: string;
  tipo: 'lead' | 'cliente';
  nome: string;
  telefone: string | null;
  email: string | null;
  matchSource: 'phone' | 'email' | 'name';
}

export interface WhatsappConversationDetail extends WhatsappConversation {
  crmMatch?: WhatsappCrmMatch | null;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

export async function fetchWhatsappConversations(params: {
  status?: WhatsappConversationStatus | 'all';
  q?: string;
  limit?: number;
}): Promise<WhatsappConversation[]> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.q) search.set('q', params.q);
  if (params.limit) search.set('limit', String(params.limit));
  const suffix = search.toString() ? `?${search.toString()}` : '';
  const result = await apiGet<ApiEnvelope<WhatsappConversation[]>>(
    `/whatsapp-conversations${suffix}`
  );
  return result.data;
}

export async function fetchWhatsappMessages(conversationId: string): Promise<WhatsappMessage[]> {
  const result = await apiGet<ApiEnvelope<WhatsappMessage[]>>(
    `/whatsapp-conversations?messages=${encodeURIComponent(conversationId)}`
  );
  return result.data;
}

export async function syncWhatsappConversations(): Promise<{
  conversations: WhatsappConversation[];
  syncedMessages: number;
}> {
  const result = await apiPost<
    ApiEnvelope<{ conversations: WhatsappConversation[]; syncedMessages: number }>
  >('/whatsapp-conversations', { action: 'sync', chatLimit: 5, messageLimit: 100 });
  return result.data;
}

export async function syncMessagesForConversation(
  conversationId: string
): Promise<WhatsappMessage[]> {
  const result = await apiPost<ApiEnvelope<WhatsappMessage[]>>('/whatsapp-conversations', {
    action: 'sync-messages',
    id: conversationId,
  });
  return result.data;
}

export async function extractWhatsappQuote(
  conversationId: string
): Promise<WhatsappExtractionResult> {
  const result = await apiPost<ApiEnvelope<WhatsappExtractionResult>>('/whatsapp-conversations', {
    action: 'extract-quote',
    id: conversationId,
  });
  return result.data;
}

export async function createWhatsappPreQuote(
  conversationId: string,
  extractedPayload?: Record<string, unknown>
): Promise<unknown> {
  const result = await apiPost<ApiEnvelope<unknown>>('/whatsapp-conversations', {
    action: 'create-quote-lead',
    id: conversationId,
    extractedPayload,
  });
  return result.data;
}

export async function sendWhatsappMessage(
  conversationId: string,
  text: string
): Promise<WhatsappMessage[]> {
  const result = await apiPost<ApiEnvelope<WhatsappMessage[]>>('/whatsapp-conversations', {
    action: 'send-message',
    id: conversationId,
    text,
  });
  return result.data;
}

export async function updateWhatsappConversationStatus(
  conversationId: string,
  status: WhatsappConversationStatus
): Promise<WhatsappConversation> {
  const result = await apiPatch<ApiEnvelope<WhatsappConversation>>('/whatsapp-conversations', {
    id: conversationId,
    status,
  });
  return result.data;
}

export async function fetchWhatsappConversation(id: string): Promise<WhatsappConversationDetail> {
  const result = await apiGet<ApiEnvelope<WhatsappConversationDetail>>(
    `/whatsapp-conversations?id=${encodeURIComponent(id)}`
  );
  return result.data;
}
