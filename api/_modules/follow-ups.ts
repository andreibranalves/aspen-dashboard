import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  ConflictError,
  InputError,
  NotFoundError,
  createQuotationFollowUpModule,
  type QuotationFollowUpModule,
} from './quotation-follow-ups.js';
import {
  DISMISS_REASONS,
  FOLLOW_UP_MESSAGE_MAX_CHARS,
  followUpExternalWritesEnabled,
  isDismissReason,
  isFollowUpListView,
  normalizeWhatsappOutboundText,
} from './quotation-follow-up-state.js';
import { wakeWorker } from '../_infrastructure/integrations/worker/client.js';

export interface FollowUpsHandlerDependencies {
  followUpModule?: QuotationFollowUpModule;
  wakeWorker?: typeof wakeWorker;
  environment?: {
    APP_ENV?: string;
    EXTERNAL_WRITES_ENABLED?: string;
    QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED?: string;
  };
}

class HandlerInputError extends Error {
  readonly statusCode = 400;
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function bodyObject(event: FunctionEvent): Record<string, unknown> {
  try {
    const parsed = JSON.parse(event.body || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HandlerInputError('JSON inválido.');
  }
}

function text(value: unknown, message: string, max = 255): string {
  if (typeof value !== 'string') throw new HandlerInputError(message);
  const result = value.trim();
  if (
    !result ||
    result.length > max ||
    [...result].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new HandlerInputError(message);
  }
  return result;
}

function page(value: string | undefined, label: string, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new HandlerInputError(`${label} inválida.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new HandlerInputError(`${label} inválida.`);
  return number;
}

function requestedView(event: FunctionEvent) {
  const value = event.queryStringParameters?.view?.trim() || 'ready';
  if (!isFollowUpListView(value)) throw new HandlerInputError('Visualização inválida.');
  return value;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function publicRecord(record: Record<string, unknown>): Record<string, unknown> {
  return {
    follow_up_id: record.followUpId ?? record.id ?? null,
    approved_opportunity_id: record.approvedOpportunityId ?? null,
    quotation_id: record.quotationId,
    revision_id: record.revisionId,
    delivery_id: record.deliveryId,
    business_number: record.businessNumber,
    client_name: record.clientName,
    amount: record.amount,
    instance: record.instance,
    provider_conversation_id: record.providerConversationId,
    canonical_phone: record.canonicalPhone,
    delivery_created_at: iso(record.deliveryCreatedAt as Date),
    first_provider_receipt_at: iso(record.firstProviderReceiptAt as Date | null),
    due_at: iso(record.dueAt as Date | null),
    eligibility_version: record.eligibilityVersion ?? null,
    state: record.state,
    reason: record.reason,
    reason_label: record.reasonLabel,
    message_snapshot: record.messageSnapshot,
    closed_reason: record.closedReason,
    approved_at: iso(record.approvedAt as Date | null),
    sent_at: iso(record.sentAt as Date | null),
    updated_at: iso(record.updatedAt as Date),
  };
}

function mapError(error: unknown): FunctionResult {
  if (error instanceof HandlerInputError || error instanceof InputError) {
    return json(400, { error: error.message });
  }
  if (error instanceof ConflictError) return json(409, { error: error.message });
  if (error instanceof NotFoundError) return json(404, { error: error.message });
  const candidate = error as { statusCode?: unknown; message?: unknown };
  if (Number(candidate?.statusCode) === 409) {
    return json(409, { error: 'A fila mudou. Recarregue e tente novamente.' });
  }
  if (Number(candidate?.statusCode) === 404) return json(404, { error: 'Orçamento não encontrado.' });
  if (Number(candidate?.statusCode) === 400) return json(400, { error: 'Requisição inválida.' });
  return json(503, { error: 'Não foi possível atualizar os follow-ups. Tente novamente.' });
}

export function createFollowUpsHandler(
  dependencies: FollowUpsHandlerDependencies = {},
): (event: FunctionEvent) => Promise<FunctionResult> {
  const module = dependencies.followUpModule || createQuotationFollowUpModule();
  const environment = dependencies.environment || process.env;

  return async (event: FunctionEvent): Promise<FunctionResult> => {
    const method = String(event.httpMethod || '').toUpperCase();
    if (method !== 'GET' && method !== 'POST' && method !== 'PATCH') {
      return json(405, { error: 'Método não permitido.' });
    }

    try {
      if (method === 'GET') {
        const quotationId = event.queryStringParameters?.quotation_id;
        if (quotationId !== undefined) {
          const requestedQuotation = text(quotationId, 'Identificador do orçamento inválido.');
          const expectedOpportunity = event.queryStringParameters?.opportunity_id;
          const expectedAction = event.queryStringParameters?.action_id;
          if (expectedOpportunity === undefined || expectedAction === undefined) {
            throw new HandlerInputError('Oportunidade e ação de origem são obrigatórias.');
          }
          const result = await module.get(requestedQuotation, {
            expectedOpportunityId: text(expectedOpportunity, 'Identificador da oportunidade inválido.'),
            expectedActionId: text(expectedAction, 'Identificador da ação inválido.'),
          });
          if (!result) throw new NotFoundError();
          return json(200, { data: publicRecord(result as unknown as Record<string, unknown>) });
        }
        const pageNumber = page(event.queryStringParameters?.page, 'Página', 1);
        const pageSize = page(event.queryStringParameters?.page_size, 'Tamanho da página', 25);
        if (pageSize > 100) throw new HandlerInputError('Tamanho máximo da página é 100.');
        const result = await module.list({
          view: requestedView(event),
          page: pageNumber,
          pageSize,
        });
        return json(200, {
          data: result.data.map((row) => publicRecord(row as unknown as Record<string, unknown>)),
          total: result.total,
          page: result.page ?? pageNumber,
          page_size: result.pageSize ?? pageSize,
        });
      }

      const body = bodyObject(event);
      const quotationId = text(body.quotation_id, 'Identificador do orçamento inválido.');
      const eligibilityVersion =
        method === 'PATCH' &&
        (body.eligibility_version === undefined || body.eligibility_version === null || body.eligibility_version === '')
          ? ''
          : text(body.eligibility_version, 'Versão de elegibilidade inválida.', 64);
      if (eligibilityVersion && !/^[0-9a-f]{64}$/.test(eligibilityVersion)) {
        throw new HandlerInputError('Versão de elegibilidade inválida.');
      }

      if (method === 'POST') {
        if (!followUpExternalWritesEnabled(environment)) {
          return json(409, { error: 'Envio automático desativado' });
        }
        if (Object.keys(body).some((key) => !['quotation_id', 'eligibility_version', 'message'].includes(key))) {
          throw new HandlerInputError('Corpo inválido.');
        }
        if (typeof body.message !== 'string' || body.message.length > FOLLOW_UP_MESSAGE_MAX_CHARS) {
          throw new HandlerInputError('Mensagem inválida.');
        }
        const approvedMessage = normalizeWhatsappOutboundText(body.message);
        if (!approvedMessage) throw new HandlerInputError('Mensagem inválida.');
        const approved = await module.approve({
          quotationId,
          eligibilityVersion,
          message: approvedMessage,
        });
        const followUpId = approved.followUpId;
        if (!followUpId) throw new Error('approved row missing id');
        // A aprovação já é durável; sem o aviso, a varredura horária do worker envia.
        const workerWake = await (dependencies.wakeWorker || wakeWorker)();
        return json(201, { follow_up_id: followUpId, state: 'approved', worker_wake: workerWake });
      }

      if (Object.keys(body).some((key) => !['quotation_id', 'eligibility_version', 'reason'].includes(key))) {
        throw new HandlerInputError('Corpo inválido.');
      }
      if (typeof body.reason !== 'string' || !isDismissReason(body.reason)) {
        throw new HandlerInputError('Motivo de dispensa inválido.');
      }
      const dismissed = await module.dismiss({
        quotationId,
        eligibilityVersion,
        reason: body.reason,
      });
      return json(200, { follow_up_id: dismissed.followUpId, state: 'dismissed' });
    } catch (error) {
      return mapError(error);
    }
  };
}

export const handler = createFollowUpsHandler();
export const followUps = handler;
export { DISMISS_REASONS };
