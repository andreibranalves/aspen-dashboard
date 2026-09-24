import { apiGet, apiPost } from '@/lib/api/api';

export type AttendanceAiAction = 'suggest_reply' | 'identify_missing' | 'summarize';

export interface AttendanceAiResult {
  action: AttendanceAiAction;
  conversationId: string;
  contextVersion: string;
  text: string;
  missingFields: string[];
  sources: Array<{ kind: 'message' | 'quotation_revision'; id: string }>;
  warnings: string[];
}

export function generateAttendanceAi(conversationId: string, action: AttendanceAiAction) {
  return apiPost<AttendanceAiResult>('/atendimento-ai', { conversationId, action });
}

export function fetchAttendanceAiVersion(conversationId: string) {
  return apiGet<{ conversationId: string; contextVersion: string }>(`/atendimento-ai?conversationId=${encodeURIComponent(conversationId)}`);
}
