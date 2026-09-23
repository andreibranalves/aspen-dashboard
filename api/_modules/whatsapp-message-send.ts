// Operator replies (M1b, spec §10.1 and §14): the intent is recorded and
// committed before the transport, dispatched inside the same request, and the
// response is always the persisted state, never a delivery guarantee.

import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  createPostgresWhatsappMessageOutboxRepository,
  OutboxActionRefused,
  OutboxIntentRefused,
  type IntentRefusal,
  type OutboxRecord,
  type WhatsappMessageOutboxRepository,
} from '../_infrastructure/db/repositories/whatsapp-message-outbox-repository.js';
import { hasDisallowedWhatsappControls } from './quotation-follow-up-state.js';
import { dispatchOutboxMessage, type SendText } from './whatsapp-message-dispatch.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_REPLY_CHARS = 4_000;

export interface MessageSendDependencies {
  repository?: WhatsappMessageOutboxRepository;
  send?: SendText;
}

class InputError extends Error {}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
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

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new InputError(`${label} inválido.`);
  return value.toLowerCase();
}

export function projectOutbox(record: OutboxRecord) {
  return {
    messageId: record.messageId,
    conversationId: record.conversationId,
    clientRequestId: record.clientRequestId,
    state: record.state,
    failureCode: record.failureCode,
    resolution: record.resolution,
  };
}

const REFUSALS: Record<IntentRefusal, { status: number; code: string; error: string }> = {
  conversation_not_found: { status: 404, code: 'CONVERSATION_NOT_FOUND', error: 'Conversa não encontrada.' },
  identity_unresolved: {
    status: 409,
    code: 'IDENTITY_CONFLICT',
    error: 'O telefone desta conversa não foi identificado. Responda pelo WhatsApp.',
  },
  identity_conflict: {
    status: 409,
    code: 'IDENTITY_CONFLICT',
    error: 'O telefone desta conversa está em conflito. Revise antes de responder.',
  },
  identity_changed: {
    status: 409,
    code: 'IDENTITY_CONFLICT',
    error: 'O destinatário desta conversa mudou. Revise a conversa antes de enviar.',
  },
  idempotency_conflict: {
    status: 409,
    code: 'IDEMPOTENCY_CONFLICT',
    error: 'Esta tentativa de envio já foi registrada com outro conteúdo.',
  },
};

async function handle(run: () => Promise<FunctionResult>, failure: string): Promise<FunctionResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof InputError) return json(400, { error: error.message });
    if (error instanceof OutboxIntentRefused) {
      const refusal = REFUSALS[error.reason];
      return json(refusal.status, { code: refusal.code, error: refusal.error });
    }
    console.error('[whatsapp-message-send]', error instanceof Error ? error.name : typeof error);
    return json(503, { error: failure });
  }
}

/** POST /api/whatsapp-messages */
export async function postOperatorMessage(
  event: FunctionEvent,
  dependencies: MessageSendDependencies = {},
): Promise<FunctionResult> {
  return handle(async () => {
    const repository = dependencies.repository || createPostgresWhatsappMessageOutboxRepository();
    const body = parseBody(event);
    const clientRequestId = uuid(body.clientRequestId, 'Identificador da tentativa');
    const conversationId = uuid(body.conversationId, 'Conversa');
    const version = body.expectedIdentityVersion;
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
      throw new InputError('Versão de identidade inválida.');
    }
    if (Array.isArray(body.attachmentIds) && body.attachmentIds.length > 0) {
      throw new InputError('Envio de anexos ainda não está disponível.');
    }
    const text = typeof body.body === 'string' ? body.body.replace(/\r\n?/g, '\n') : '';
    if (!text.trim()) throw new InputError('Escreva a mensagem antes de enviar.');
    if (text.length > MAX_REPLY_CHARS) {
      return json(400, { code: 'MESSAGE_TOO_LARGE', error: `A mensagem passa de ${MAX_REPLY_CHARS} caracteres.` });
    }
    if (hasDisallowedWhatsappControls(text)) throw new InputError('A mensagem contém caracteres não permitidos.');

    const { record, created } = await repository.createIntent({
      clientRequestId,
      conversationId,
      expectedIdentityVersion: version,
      body: text,
    });
    // A repeated key returns the recorded operation and never transports again.
    const result =
      created && record.state === 'queued'
        ? (await dispatchOutboxMessage(record.id, { repository, send: dependencies.send })) ||
          (await repository.findByMessageId(record.messageId)) ||
          record
        : record;
    return json(202, { message: projectOutbox(result) });
  }, 'Não foi possível registrar o envio. Tente novamente.');
}

/** GET /api/whatsapp-messages?conversationId=…&clientRequestId=… */
export async function getOperatorMessageByRequest(
  conversationId: string,
  clientRequestIdRaw: string,
  dependencies: MessageSendDependencies = {},
): Promise<FunctionResult> {
  return handle(async () => {
    const repository = dependencies.repository || createPostgresWhatsappMessageOutboxRepository();
    const clientRequestId = uuid(clientRequestIdRaw, 'Identificador da tentativa');
    const record = await repository.findByClientRequestId(clientRequestId);
    if (!record || record.conversationId !== conversationId) {
      return json(404, { error: 'Tentativa de envio não encontrada.' });
    }
    return json(200, { message: projectOutbox(record) });
  }, 'Não foi possível consultar o envio. Tente novamente.');
}

const ACTIONS = ['cancel', 'confirm_sent', 'confirm_not_sent'] as const;
type MessageAction = (typeof ACTIONS)[number];

/** POST /api/whatsapp-message-actions */
export function createWhatsappMessageActionsHandler(dependencies: MessageSendDependencies = {}) {
  return async function whatsappMessageActionsHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (String(event.httpMethod || '').toUpperCase() !== 'POST') {
      return json(405, { error: 'Método não permitido.' });
    }
    return handle(async () => {
      const repository = dependencies.repository || createPostgresWhatsappMessageOutboxRepository();
      const body = parseBody(event);
      const messageId = uuid(body.messageId, 'Mensagem');
      const action = body.action as MessageAction;
      if (!ACTIONS.includes(action)) throw new InputError('Ação inválida.');
      const expectedRevision = body.expectedRevision;
      if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
        throw new InputError('Versão da mensagem inválida.');
      }
      try {
        const record =
          action === 'cancel'
            ? await repository.cancel(messageId, expectedRevision)
            : await repository.resolveReview(
                messageId,
                action === 'confirm_sent' ? 'confirmed_sent' : 'confirmed_not_sent',
                expectedRevision,
              );
        return json(200, { message: projectOutbox(record) });
      } catch (error) {
        if (error instanceof OutboxActionRefused) {
          if (!error.current) return json(404, { error: 'Mensagem não encontrada.' });
          if (error.reason === 'stale') {
            return json(409, {
              code: 'MESSAGE_VERSION_CHANGED',
              error: 'O envio mudou desde que a conversa foi carregada. Confira o estado atual.',
              message: projectOutbox(error.current),
            });
          }
          return json(409, {
            code: action === 'cancel' ? 'SEND_ALREADY_RESERVED' : 'SEND_REQUIRES_REVIEW',
            error:
              action === 'cancel'
                ? 'O envio já foi reservado e não pode mais ser cancelado.'
                : 'Esta mensagem não está aguardando revisão.',
            message: projectOutbox(error.current),
          });
        }
        throw error;
      }
    }, 'Não foi possível atualizar o envio. Tente novamente.');
  };
}

export const whatsappMessageActions = createWhatsappMessageActionsHandler();
