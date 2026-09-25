// Attendance read API (M1a). The frontend only sees local ids: provider
// conversation ids and instance names never leave the backend.

import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { getEvolutionConfig } from '../_infrastructure/integrations/evolution/config.js';
import {
  getOperatorMessageByRequest,
  postOperatorMessage,
  type MessageSendDependencies,
} from './whatsapp-message-send.js';
import {
  createPostgresWhatsappAttendanceRepository,
  WHATSAPP_CONVERSATION_STATUSES,
  WhatsappConversationChangedError,
  type TimelineCursor,
  type WhatsappAttendanceRepository,
  type WhatsappConversationRecord,
  type WhatsappConversationStatus,
  type WhatsappMessageRecord,
} from '../_infrastructure/db/repositories/whatsapp-attendance-repository.js';
import { safeErrorSummary } from '../_shared/safe-error.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;
const MAX_SEARCH_CHARS = 80;

export interface WhatsappAttendanceDependencies {
  repository?: WhatsappAttendanceRepository;
  send?: MessageSendDependencies;
  instance?: () => string;
}

class InputError extends Error {}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function query(event: FunctionEvent, name: string): string {
  const value = event.queryStringParameters?.[name];
  return typeof value === 'string' ? value.trim() : '';
}

function parseLimit(raw: string): number {
  if (!raw) return DEFAULT_PAGE;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE) {
    throw new InputError(`O limite deve estar entre 1 e ${MAX_PAGE}.`);
  }
  return value;
}

function parseId(raw: string, label: string): string {
  if (!UUID_PATTERN.test(raw)) throw new InputError(`${label} inválido.`);
  return raw.toLowerCase();
}

export function encodeCursor(cursor: TimelineCursor): string {
  return Buffer.from(`${cursor.at.toISOString()}|${cursor.id}`, 'utf8').toString('base64url');
}

function decodeCursor(raw: string): TimelineCursor | null {
  if (!raw) return null;
  const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const at = new Date(iso || '');
  if (Number.isNaN(at.getTime()) || !UUID_PATTERN.test(id || '')) {
    throw new InputError('Cursor inválido.');
  }
  return { at, id };
}

function projectConversation(record: WhatsappConversationRecord) {
  return {
    id: record.id,
    displayName: record.displayName,
    phone: record.canonicalPhone,
    identityStatus: record.identityStatus,
    identityVersion: record.identityVersion,
    status: record.status,
    unreadCount: record.unreadCount,
    revision: record.revision,
    readRevision: record.readRevision,
    lastMessageAt: record.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview: record.lastMessagePreview,
    lastMessageDirection: record.lastMessageDirection,
  };
}

function projectMessage(record: WhatsappMessageRecord) {
  return {
    id: record.id,
    direction: record.direction,
    type: record.messageType,
    body: record.body,
    origin: record.origin,
    timestamp: record.providerTimestamp.toISOString(),
    createdRevision: record.createdRevision,
    revision: record.revision,
    deliveryStatus: record.deliveryStatus,
    outboxState: record.outboxState,
    failureCode: record.failureCode,
    resolution: record.resolution,
    supersededBy: record.supersededBy,
  };
}

function parseStatusFilter(raw: string): WhatsappConversationStatus | 'active' | undefined {
  if (!raw || raw === 'all') return undefined;
  if (raw === 'active') return 'active';
  if ((WHATSAPP_CONVERSATION_STATUSES as readonly string[]).includes(raw)) {
    return raw as WhatsappConversationStatus;
  }
  throw new InputError('Situação inválida.');
}

async function handleErrors(run: () => Promise<FunctionResult>, failure: string): Promise<FunctionResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof InputError) return json(400, { error: error.message });
    console.error('[whatsapp-attendance]', safeErrorSummary(error));
    return json(503, { error: failure });
  }
}

function parseBody(event: FunctionEvent): Record<string, unknown> {
  try {
    const value = JSON.parse(event.body || '');
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // handled below
  }
  throw new InputError('Corpo da requisição inválido.');
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new InputError(`${label} inválida.`);
  }
  return value;
}

async function patchConversation(
  event: FunctionEvent,
  repository: WhatsappAttendanceRepository,
): Promise<FunctionResult> {
  return handleErrors(async () => {
    const body = parseBody(event);
    const id = parseId(typeof body.id === 'string' ? body.id : '', 'Conversa');
    const hasStatus = body.status !== undefined;
    const hasRead = body.readRevision !== undefined;
    if (hasStatus === hasRead) throw new InputError('Informe a situação ou a posição de leitura.');

    if (hasRead) {
      const updated = await repository.markRead({ id, readRevision: nonNegativeInteger(body.readRevision, 'Posição de leitura') });
      if (!updated) return json(404, { error: 'Conversa não encontrada.' });
      return json(200, { conversation: projectConversation(updated) });
    }

    const status = typeof body.status === 'string' ? body.status : '';
    if (!(WHATSAPP_CONVERSATION_STATUSES as readonly string[]).includes(status)) {
      throw new InputError('Situação inválida.');
    }
    try {
      const updated = await repository.updateStatus({
        id,
        status: status as WhatsappConversationStatus,
        expectedRevision: nonNegativeInteger(body.expectedRevision, 'Revisão esperada'),
      });
      if (!updated) return json(404, { error: 'Conversa não encontrada.' });
      return json(200, { conversation: projectConversation(updated) });
    } catch (error) {
      if (error instanceof WhatsappConversationChangedError) {
        return json(409, {
          code: 'CONVERSATION_CHANGED',
          error: 'A conversa mudou desde a última atualização. Revise as mensagens novas antes de alterar a situação.',
          conversation: projectConversation(error.current),
        });
      }
      throw error;
    }
  }, 'Não foi possível atualizar a conversa. Tente novamente.');
}

export function createWhatsappConversationsHandler(dependencies: WhatsappAttendanceDependencies = {}) {
  return async function whatsappConversationsHandler(event: FunctionEvent): Promise<FunctionResult> {
    const repository = dependencies.repository || createPostgresWhatsappAttendanceRepository();
    const method = String(event.httpMethod || '').toUpperCase();
    if (method === 'PATCH') return patchConversation(event, repository);
    if (method !== 'GET') return json(405, { error: 'Método não permitido.' });

    return handleErrors(async () => {
      const id = query(event, 'id');
      if (id) {
        const conversation = await repository.getConversation(parseId(id, 'Conversa'));
        if (!conversation) return json(404, { error: 'Conversa não encontrada.' });
        return json(200, { conversation: projectConversation(conversation) });
      }

      const instance = (dependencies.instance || (() => getEvolutionConfig().instance))().trim();
      if (!instance) return json(503, { error: 'Integração WhatsApp não configurada.' });
      const limit = parseLimit(query(event, 'limit'));
      const search = query(event, 'q').slice(0, MAX_SEARCH_CHARS);
      const page = await repository.listConversations({
        instance,
        status: parseStatusFilter(query(event, 'status')),
        search,
        limit,
        cursor: decodeCursor(query(event, 'cursor')),
      });
      const last = page.items.at(-1);
      return json(200, {
        items: page.items.map(projectConversation),
        hasMore: page.hasMore,
        nextCursor:
          page.hasMore && last?.lastMessageAt ? encodeCursor({ at: last.lastMessageAt, id: last.id }) : null,
      });
    }, 'Não foi possível carregar as conversas. Tente novamente.');
  };
}

export function createWhatsappMessagesHandler(dependencies: WhatsappAttendanceDependencies = {}) {
  return async function whatsappMessagesHandler(event: FunctionEvent): Promise<FunctionResult> {
    const repository = dependencies.repository || createPostgresWhatsappAttendanceRepository();
    const method = String(event.httpMethod || '').toUpperCase();
    if (method === 'POST') return postOperatorMessage(event, dependencies.send);
    if (method !== 'GET') return json(405, { error: 'Método não permitido.' });

    return handleErrors(async () => {
      const conversationId = parseId(query(event, 'conversationId'), 'Conversa');
      const clientRequestId = query(event, 'clientRequestId');
      if (clientRequestId) return getOperatorMessageByRequest(conversationId, clientRequestId, dependencies.send);
      const limit = parseLimit(query(event, 'limit'));
      const afterRaw = query(event, 'afterRevision');
      const beforeRaw = query(event, 'before');
      if (afterRaw && beforeRaw) throw new InputError('Use before ou afterRevision, não ambos.');

      // The conversation is read before the page: every change up to this
      // revision is then guaranteed to be in the page or already known.
      const conversation = await repository.getConversation(conversationId);
      if (!conversation) return json(404, { error: 'Conversa não encontrada.' });

      if (afterRaw) {
        const afterRevision = Number(afterRaw);
        if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) {
          throw new InputError('Revisão inválida.');
        }
        const page = await repository.listMessagesAfterRevision({ conversationId, afterRevision, limit });
        const lastRevision = page.items.at(-1)?.revision ?? afterRevision;
        return json(200, {
          conversation: projectConversation(conversation),
          items: page.items.map(projectMessage),
          hasMore: page.hasMore,
          revision: page.hasMore ? lastRevision : Math.max(conversation.revision, lastRevision),
        });
      }

      const page = await repository.listMessagesBefore({
        conversationId,
        before: decodeCursor(beforeRaw),
        limit,
      });
      const oldest = page.items[0];
      return json(200, {
        conversation: projectConversation(conversation),
        items: page.items.map(projectMessage),
        hasMore: page.hasMore,
        nextCursor: page.hasMore && oldest ? encodeCursor({ at: oldest.providerTimestamp, id: oldest.id }) : null,
        revision: conversation.revision,
      });
    }, 'Não foi possível carregar as mensagens. Tente novamente.');
  };
}

export const whatsappConversations = createWhatsappConversationsHandler();
export const whatsappMessages = createWhatsappMessagesHandler();
