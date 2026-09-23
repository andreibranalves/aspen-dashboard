import { apiGet, apiPatch, apiPost } from '@/lib/api/api';

export type AttendanceStatus = 'open' | 'waiting_customer' | 'closed' | 'ignored';
export type AttendanceStatusFilter = AttendanceStatus | 'active';
export type AttendanceMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'unsupported';

export interface AttendanceConversation {
  id: string;
  displayName: string | null;
  phone: string | null;
  identityStatus: 'verified' | 'derived' | 'unresolved' | 'conflict';
  identityVersion: number;
  status: AttendanceStatus;
  unreadCount: number;
  revision: number;
  readRevision: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: 'inbound' | 'outbound' | null;
}

export interface AttendanceMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  type: AttendanceMessageType;
  body: string | null;
  origin: 'live' | 'backfill' | 'operator' | 'quotation';
  timestamp: string;
  createdRevision: number;
  revision: number;
  deliveryStatus: 'server_ack' | 'delivered' | 'read' | 'error' | null;
  outboxState: OutboxState | null;
  failureCode: string | null;
  resolution: 'confirmed_sent' | 'confirmed_not_sent' | null;
  supersededBy: string | null;
}

export type OutboxState =
  | 'queued'
  | 'dispatching'
  | 'provider_accepted'
  | 'retry_scheduled'
  | 'failed'
  | 'needs_review'
  | 'cancelled';

export interface SendResult {
  messageId: string;
  conversationId: string;
  clientRequestId: string;
  state: OutboxState;
  failureCode: string | null;
  resolution: 'confirmed_sent' | 'confirmed_not_sent' | null;
}

export interface ConversationPage {
  items: AttendanceConversation[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface MessagePage {
  conversation: AttendanceConversation;
  items: AttendanceMessage[];
  hasMore: boolean;
  nextCursor?: string | null;
  revision: number;
}

function queryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function fetchConversations(input: {
  status: AttendanceStatusFilter;
  q?: string;
  cursor?: string | null;
  limit?: number;
}): Promise<ConversationPage> {
  return apiGet<ConversationPage>(
    `/whatsapp-conversations${queryString({ status: input.status, q: input.q, cursor: input.cursor, limit: input.limit })}`
  );
}

export function fetchMessagesBefore(conversationId: string, before?: string | null): Promise<MessagePage> {
  return apiGet<MessagePage>(`/whatsapp-messages${queryString({ conversationId, before })}`);
}

export function fetchMessagesAfter(conversationId: string, afterRevision: number): Promise<MessagePage> {
  return apiGet<MessagePage>(
    `/whatsapp-messages${queryString({ conversationId, afterRevision, limit: 100 })}`
  );
}

export async function updateConversationStatus(
  id: string,
  status: AttendanceStatus,
  expectedRevision: number
): Promise<AttendanceConversation> {
  const body = await apiPatch<{ conversation: AttendanceConversation }>('/whatsapp-conversations', {
    id,
    status,
    expectedRevision,
  });
  return body.conversation;
}

export async function markConversationRead(id: string, readRevision: number): Promise<AttendanceConversation> {
  const body = await apiPatch<{ conversation: AttendanceConversation }>('/whatsapp-conversations', {
    id,
    readRevision,
  });
  return body.conversation;
}

export async function sendOperatorMessage(input: {
  clientRequestId: string;
  conversationId: string;
  expectedIdentityVersion: number;
  body: string;
}): Promise<SendResult> {
  const body = await apiPost<{ message: SendResult }>('/whatsapp-messages', { ...input, attachmentIds: [] });
  return body.message;
}

export async function fetchSendByRequest(conversationId: string, clientRequestId: string): Promise<SendResult> {
  const body = await apiGet<{ message: SendResult }>(
    `/whatsapp-messages${queryString({ conversationId, clientRequestId })}`
  );
  return body.message;
}

export async function runMessageAction(
  messageId: string,
  action: 'cancel' | 'confirm_sent' | 'confirm_not_sent',
  expectedRevision: number
): Promise<SendResult> {
  const body = await apiPost<{ message: SendResult }>('/whatsapp-message-actions', {
    messageId,
    action,
    expectedRevision,
  });
  return body.message;
}
