import { apiGet, apiPost } from '@/lib/api/api';

export interface ContextContact {
  id: string;
  tipo: 'lead' | 'cliente';
  nome: string;
  telefone: string | null;
  email: string | null;
}

export interface ContextQuotation {
  id: string;
  businessNumber: string;
  status: string;
  date: string;
  total: string;
  url: string;
}

export interface ContextDelivery {
  id: string;
  revisionId: string;
  businessNumber: string;
  status: string;
  date: string;
}

export interface AttendanceContext {
  match: 'matched' | 'suggested' | 'ambiguous' | 'unresolved' | 'not_found' | 'conflict';
  matchSource?: 'operator' | 'phone' | 'phone-variant';
  reason?: string;
  contact?: ContextContact | null;
  candidates?: ContextContact[];
  quotations?: ContextQuotation[];
  deliveries?: ContextDelivery[];
  linking: { available: boolean; version: string | null };
  actions?: { openContact?: string; createContact?: string; search?: string };
}

export async function fetchAttendanceContext(conversationId: string, search = ''): Promise<AttendanceContext> {
  const query = new URLSearchParams({ conversationId });
  if (search) query.set('search', search);
  const body = await apiGet<{ context: AttendanceContext }>(`/atendimento-context?${query.toString()}`);
  return body.context;
}

export type ClientLinkInput =
  | {
      action: 'confirm';
      clientId: string;
      expectedVersion: string | null;
      expectedClientName: string;
      expectedClientPhone: string | null;
    }
  | { action: 'remove'; expectedVersion: string };

/** A refused link rejects with `ApiError.data` = `{ code, error, context? }`. */
export async function updateClientLink(conversationId: string, input: ClientLinkInput): Promise<AttendanceContext> {
  const body = await apiPost<{ context: AttendanceContext }>('/atendimento-client-link', { conversationId, ...input });
  return body.context;
}
