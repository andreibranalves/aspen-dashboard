import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import {
  canonicalWhatsappSendIdempotencyKey,
  isWhatsappSendReservationStale,
  parseWhatsappSendReservationRecord,
  WHATSAPP_SEND_RESOLUTION_CONFIRMATION,
  type WhatsappSendReservationRecord,
  type WhatsappSendReservationStore,
  WhatsappSendReservationStorageError,
} from './lib/whatsapp-send-reservation-store.js';
import { defaultWhatsappSendReservationStore } from './lib/whatsapp-send-reservation-store.js';

function json(statusCode: number, body: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} inválido.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 255 || normalized.includes('://') || normalized.includes('/') || normalized.includes('\\')) {
    throw new Error(`${label} inválido.`);
  }
  return normalized;
}

function payloadObject(event: FunctionEvent): Record<string, unknown> {
  try {
    const value = JSON.parse(event.body || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object');
    return value as Record<string, unknown>;
  } catch {
    throw new Error('JSON inválido.');
  }
}

function queryValue(event: FunctionEvent, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = event.queryStringParameters?.[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function identifiers(event: FunctionEvent, body: Record<string, unknown> = {}): {
  quotationId: string;
  revisionId: string;
  flowId: string;
  key: string;
} {
  const quotationId = identifier(
    body.quotation_uuid || body.quotationUuid || body.quotation_id || body.quotationId
      || queryValue(event, 'quotation_uuid', 'quotationUuid', 'quotation_id', 'quotationId'),
    'Identificador do orçamento',
  );
  const revisionId = identifier(
    body.revision_id || body.revisionId || queryValue(event, 'revision_id', 'revisionId'),
    'Identificador da revisão',
  );
  const flowId = identifier(
    body.flow_id || body.flowId || queryValue(event, 'flow_id', 'flowId'),
    'Identificador do fluxo',
  );
  return {
    quotationId,
    revisionId,
    flowId,
    key: canonicalWhatsappSendIdempotencyKey(quotationId, revisionId, flowId),
  };
}

function publicStatus(record: WhatsappSendReservationRecord): Record<string, unknown> {
  return {
    quotation_id: record.quotationId,
    revision_id: record.revisionId,
    flow_id: record.flowId,
    version: record.version,
    phase: record.phase,
    steps_count: record.stepsCount,
    stale: record.phase === 'reserved' && isWhatsappSendReservationStale(record),
    current_step: record.currentStep ?? null,
    accepted_step_numbers: record.acceptedSteps.map((step) => step.step),
    accepted_step_count: record.acceptedSteps.length,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    reserved_at: record.reservedAt,
    transport_started_at: record.transportStartedAt ?? null,
    resolved_at: record.resolvedAt ?? null,
  };
}

function malformedResponse(): FunctionResult {
  return json(503, { error: 'Estado de reconciliação inválido. Não é seguro continuar.' });
}

async function strictRead(
  store: WhatsappSendReservationStore,
  key: string,
): Promise<WhatsappSendReservationRecord | null> {
  const value = await store.get(key);
  if (!value) return null;
  return parseWhatsappSendReservationRecord(value, key);
}

async function staleReservedToRetryable(
  store: WhatsappSendReservationStore,
  record: WhatsappSendReservationRecord,
): Promise<WhatsappSendReservationRecord> {
  if (record.phase !== 'reserved' || !isWhatsappSendReservationStale(record)) return record;
  const compareAndSet = store.compareAndSet || store.cas;
  if (typeof compareAndSet !== 'function') throw new WhatsappSendReservationStorageError();
  const result = await compareAndSet({
    key: record.key,
    owner: record.owner,
    expectedVersion: record.version,
    from: 'reserved',
    to: 'retryable',
    errorMessage: 'Falha antes do transporte.',
  });
  if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
    throw new WhatsappSendReservationStorageError();
  }
  if (result.ok) return parseWhatsappSendReservationRecord(result.record, record.key);
  if (result.record?.phase === 'retryable') return parseWhatsappSendReservationRecord(result.record, record.key);
  throw new WhatsappSendReservationStorageError();
}

const RESOLUTION_KEYS = new Set([
  'quotation_uuid',
  'quotationUuid',
  'quotation_id',
  'quotationId',
  'revision_id',
  'revisionId',
  'flow_id',
  'flowId',
  'expected_version',
  'expectedVersion',
  'version',
  'resolution',
  'target_phase',
  'phase',
  'confirmation',
  'confirm',
]);

function ensureSafeResolutionBody(body: Record<string, unknown>): void {
  if (Object.keys(body).some((key) => !RESOLUTION_KEYS.has(key))) {
    throw new Error('A resolução aceita apenas identificadores locais, versão e confirmação.');
  }
  for (const key of ['provider', 'provider_id', 'message_id', 'url', 'raw', 'phone', 'telefone', 'media']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) throw new Error('Dados do provedor não são aceitos.');
  }
}

function expectedVersion(body: Record<string, unknown>): number {
  const value = body.expected_version ?? body.expectedVersion ?? body.version;
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('Versão esperada inválida.');
  return Number(value);
}

export type WhatsappSendStatusDependencies = {
  reservationStore?: WhatsappSendReservationStore;
};

export async function handler(
  event: FunctionEvent,
  dependencies: WhatsappSendStatusDependencies = {},
): Promise<FunctionResult> {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'PATCH' && event.httpMethod !== 'POST') {
    return json(405, { error: 'Método não permitido.' });
  }
  const store = dependencies.reservationStore || defaultWhatsappSendReservationStore;
  let body: Record<string, unknown> = {};
  try {
    if (event.httpMethod !== 'GET') body = payloadObject(event);
    if (event.httpMethod !== 'GET') ensureSafeResolutionBody(body);
    const ids = identifiers(event, body);
    let record = await strictRead(store, ids.key);
    if (!record) return json(404, { error: 'Estado de envio não encontrado.' });

    if (event.httpMethod === 'GET') {
      record = await staleReservedToRetryable(store, record);
      return json(200, publicStatus(record));
    }

    const requestedTarget = body.resolution || body.target_phase || body.phase;
    const target = requestedTarget === 'reconciliation-closed' || requestedTarget === 'complete'
      ? 'completed'
      : requestedTarget === 'confirmed-not-delivered' || requestedTarget === 'retry'
        ? 'retryable'
        : requestedTarget;
    if (target !== 'completed' && target !== 'retryable') throw new Error('Resolução inválida.');
    if ((body.confirmation ?? body.confirm) !== WHATSAPP_SEND_RESOLUTION_CONFIRMATION) {
      return json(400, {
        error: `Confirmação explícita obrigatória: ${WHATSAPP_SEND_RESOLUTION_CONFIRMATION}.`,
      });
    }
    if (record.phase === 'reserved' && isWhatsappSendReservationStale(record)) {
      record = await staleReservedToRetryable(store, record);
    }
    if (record.phase !== 'transporting' && record.phase !== 'accepted_partial') {
      if (record.phase === 'completed' || record.phase === 'retryable') return json(409, publicStatus(record));
      return json(409, { ...publicStatus(record), error: 'Este estado não pode ser resolvido manualmente.' });
    }

    const result = await store.resolve({
      key: ids.key,
      expectedVersion: expectedVersion(body),
      to: target,
      confirmation: WHATSAPP_SEND_RESOLUTION_CONFIRMATION,
    });
    if (result.ok) {
      const resolved = parseWhatsappSendReservationRecord(result.record, ids.key);
      return json(200, publicStatus(resolved));
    }
    const reread = await strictRead(store, ids.key);
    if (reread?.phase === 'completed' || reread?.phase === 'retryable') return json(409, publicStatus(reread));
    return json(result.reason === 'conflict' ? 409 : 503, {
      error: 'A versão mudou. Consulte o estado atual antes de reconciliar novamente.',
      reconciliation_required: true,
    });
  } catch (error) {
    if (error instanceof WhatsappSendReservationStorageError) return malformedResponse();
    return json(400, { error: error instanceof Error ? error.message : 'Requisição inválida.' });
  }
}
