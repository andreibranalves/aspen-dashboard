import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  createQuotationDeliveryModule,
  PROVIDER_DELAY_WARNING_MS,
  QuotationDeliveryModuleInputError,
  type QuotationDeliveryModule,
} from './quotation-delivery-outbox.js';
import {
  QuotationDeliveryOutboxConflictError,
  QuotationDeliveryOutboxInputError,
  QuotationDeliveryOutboxNotFoundError,
  QuotationDeliveryOutboxRepositoryError,
  type DeliveryAggregate,
  type DeliveryListFilters,
  type DeliveryListResult,
} from '../_infrastructure/db/repositories/quotation-delivery-outbox-repository.js';
import type { DeliveryState } from './quotation-delivery-state.js';

const DELIVERY_STATES: readonly DeliveryState[] = [
  'queued',
  'processing',
  'provider_accepted',
  'reconciling',
  'retry_scheduled',
  'needs_review',
  'delivered',
  'failed',
];

type PublicDeliveryView = Record<string, unknown>;

export type QuotationDeliveriesDependencies = {
  deliveryModule?: QuotationDeliveryModule;
};

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

function queryValue(event: FunctionEvent, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = event.queryStringParameters?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function localIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new HandlerInputError(`${label} inválido.`);
  const result = value.trim();
  if (
    !result ||
    result.length > 255 ||
    result.includes('/') ||
    result.includes('\\') ||
    [...result].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new HandlerInputError(`${label} inválido.`);
  }
  return result;
}

function payloadObject(event: FunctionEvent): Record<string, unknown> {
  try {
    const parsed = JSON.parse(event.body || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HandlerInputError('JSON inválido.');
  }
}

function dateQuery(value: string | undefined, label: string): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HandlerInputError(`${label} inválida.`);
  return date;
}

function integerQuery(value: string | undefined, label: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new HandlerInputError(`${label} inválida.`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new HandlerInputError(`${label} inválida.`);
  return result;
}

function booleanQuery(value: string | undefined, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new HandlerInputError(`${label} inválido.`);
}

function statesQuery(value: string | undefined): DeliveryState[] | undefined {
  if (value === undefined) return undefined;
  const states = value.split(',').map((state) => state.trim()).filter(Boolean);
  if (
    states.length === 0 ||
    states.some((state) => !DELIVERY_STATES.includes(state as DeliveryState))
  ) {
    throw new HandlerInputError('Estados de entrega inválidos.');
  }
  return [...new Set(states)] as DeliveryState[];
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function safeSearch(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length > 255 || [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  })) {
    throw new HandlerInputError('Busca inválida.');
  }
  return value;
}

export function toPublicDeliveryView(
  delivery: DeliveryAggregate,
  options: { includePhone?: boolean } = {},
): PublicDeliveryView {
  const steps = Array.isArray(delivery.steps) ? delivery.steps : [];
  const delivered = steps.filter((step) => step.state === 'delivered' || step.state === 'read').length;
  // Acceptance and delivery are different facts and the screen must never
  // conflate them: `accepted` counts the durable acceptance clock the provider
  // wrote (`accepted_at`), so a later ERROR receipt that moves a step to
  // `needs_review` cannot erase it, and a step the operator confirmed manually
  // never counts as accepted by the provider. `delivered` keeps counting only
  // device receipts. Derived from `quotation_delivery_steps` on read; no durable
  // counter exists or is introduced.
  const accepted = steps.filter((step) => Boolean(step.acceptedAt)).length;
  const actionDeadline =
    delivery.state === 'provider_accepted'
      ? delivery.actionDeadline instanceof Date && !Number.isNaN(delivery.actionDeadline.getTime())
        ? delivery.actionDeadline
        : delivery.updatedAt instanceof Date && !Number.isNaN(delivery.updatedAt.getTime())
          ? new Date(delivery.updatedAt.getTime() + PROVIDER_DELAY_WARNING_MS)
          : null
      : null;
  const view: PublicDeliveryView = {
    id: text(delivery.id),
    revision_id: text(delivery.revisionId),
    business_number: text(delivery.businessNumber),
    client_name: text(delivery.clientName),
    flow_id: text(delivery.flowId),
    flow_name: text(delivery.flowName),
    state: delivery.state,
    completion_source: delivery.completionSource || null,
    public_error: delivery.publicError || null,
    progress: { accepted, delivered, total: steps.length },
    steps: steps.map((step) => ({
      id: text(step.id),
      position: step.position,
      type: step.type,
      state: step.state,
      attempt_count: step.attemptCount,
      public_error: step.publicError || null,
      failure_kind: step.failureKind || null,
      next_attempt_at: iso(step.nextAttemptAt),
      accepted_at: iso(step.acceptedAt),
      delivered_at: iso(step.deliveredAt),
      read_at: iso(step.readAt),
      updated_at: iso(step.updatedAt),
    })),
    next_attempt_at: iso(delivery.nextAttemptAt),
    action_deadline: iso(actionDeadline),
    reconciliation_deadline: iso(delivery.reconciliationDeadline),
    delivered_at: iso(delivery.deliveredAt),
    created_at: iso(delivery.createdAt),
    updated_at: iso(delivery.updatedAt),
  };
  if (options.includePhone === true) view.phone = text(delivery.phone);
  return view;
}

function publicSummary(summary: DeliveryListResult['summary']): Record<string, number> {
  return {
    active: summary.active,
    requires_action: summary.requiresAction,
    retry_scheduled: summary.retryScheduled,
    delayed: summary.delayed,
    delivered_last_24_hours: summary.deliveredLast24Hours,
  };
}

export function deliveryErrorResponse(error: unknown): FunctionResult {
  if (error instanceof HandlerInputError || error instanceof QuotationDeliveryModuleInputError) {
    return json(400, { error: error.message });
  }
  if (error instanceof QuotationDeliveryOutboxInputError) {
    return json(400, { error: error.message });
  }
  if (error instanceof QuotationDeliveryOutboxNotFoundError) {
    return json(404, { error: 'Entrega não encontrada.' });
  }
  if (error instanceof QuotationDeliveryOutboxConflictError) {
    return json(409, { error: error.message });
  }
  if (error instanceof QuotationDeliveryOutboxRepositoryError) {
    return json(503, { error: 'Não foi possível atualizar a entrega. Tente novamente.' });
  }
  const candidate = error as { statusCode?: unknown; message?: unknown; logMessage?: unknown };
  const statusCode = Number(candidate?.statusCode);
  if (
    statusCode === 400 &&
    typeof candidate.message === 'string' &&
    typeof candidate.logMessage === 'string' &&
    candidate.message.length > 0 &&
    candidate.message.length <= 500 &&
    ![...candidate.message].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    return json(400, { error: candidate.message });
  }
  if (statusCode === 400) return json(400, { error: 'Requisição inválida.' });
  if (statusCode === 404) return json(404, { error: 'Entrega não encontrada.' });
  if (statusCode === 409) return json(409, { error: 'A entrega não pode ser alterada.' });
  return json(503, { error: 'Não foi possível consultar a entrega. Tente novamente.' });
}

function resolutionInput(
  event: FunctionEvent,
  body: Record<string, unknown>,
): { deliveryId?: string; revisionId?: string; flowId?: string } {
  const deliveryValue = body.id || body.delivery_id || body.deliveryId || queryValue(event, 'id', 'delivery_id', 'deliveryId');
  const revisionValue = body.revision_id || body.revisionId || queryValue(event, 'revision_id', 'revisionId');
  const flowValue = body.flow_id || body.flowId || queryValue(event, 'flow_id', 'flowId');
  if (deliveryValue !== undefined && deliveryValue !== null && deliveryValue !== '') {
    return { deliveryId: localIdentifier(deliveryValue, 'Identificador da entrega') };
  }
  if (!revisionValue || !flowValue) {
    throw new HandlerInputError('Identificador da entrega é obrigatório.');
  }
  return {
    revisionId: localIdentifier(revisionValue, 'Identificador da revisão'),
    flowId: localIdentifier(flowValue, 'Fluxo'),
  };
}

const RESOLUTION_KEYS = new Set([
  'id',
  'delivery_id',
  'deliveryId',
  'revision_id',
  'revisionId',
  'flow_id',
  'flowId',
  'decision',
  'note',
  'resolved_by',
]);

function ensureResolutionBody(body: Record<string, unknown>): void {
  if (Object.keys(body).some((key) => !RESOLUTION_KEYS.has(key))) {
    throw new HandlerInputError('A resolução aceita apenas identificadores e justificativa.');
  }
}

function resolutionBody(body: Record<string, unknown>): {
  decision: 'confirmed_received' | 'confirmed_not_received' | 'retry_same_revision';
  note: string;
} {
  const decision = body.decision;
  if (
    decision !== 'confirmed_received' &&
    decision !== 'confirmed_not_received' &&
    decision !== 'retry_same_revision'
  ) {
    throw new HandlerInputError('Decisão de resolução inválida.');
  }
  if (typeof body.note !== 'string') throw new HandlerInputError('Justificativa inválida.');
  const note = body.note.trim();
  if (note.length < 3 || note.length > 500 || [...note].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  })) {
    throw new HandlerInputError('Justificativa inválida.');
  }
  return { decision, note };
}

function ensureCancelPendingBody(body: Record<string, unknown>): void {
  if (Object.keys(body).length !== 1 || body.action !== 'cancel_pending') {
    throw new HandlerInputError('Ação de fila inválida.');
  }
}

export async function handler(
  event: FunctionEvent,
  dependencies: QuotationDeliveriesDependencies = {},
): Promise<FunctionResult> {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'PATCH' && event.httpMethod !== 'POST') {
    return json(405, { error: 'Método não permitido.' });
  }
  const deliveryModule = dependencies.deliveryModule || createQuotationDeliveryModule();
  try {
    if (event.httpMethod === 'GET') {
      const id = queryValue(event, 'id', 'delivery_id', 'deliveryId');
      const revisionId = queryValue(event, 'revision_id', 'revisionId');
      const flowId = queryValue(event, 'flow_id', 'flowId');
      if (id) {
        const delivery = await deliveryModule.get({
          deliveryId: localIdentifier(id, 'Identificador da entrega'),
        });
        if (!delivery) return json(404, { error: 'Entrega não encontrada.' });
        return json(200, toPublicDeliveryView(delivery, { includePhone: true }));
      }
      if (revisionId && flowId) {
        const delivery = await deliveryModule.get({
          identity: {
            revisionId: localIdentifier(revisionId, 'Identificador da revisão'),
            flowId: localIdentifier(flowId, 'Fluxo'),
          },
        });
        if (!delivery) return json(404, { error: 'Entrega não encontrada.' });
        return json(200, toPublicDeliveryView(delivery, { includePhone: true }));
      }
      const filters: DeliveryListFilters = {
        states: statesQuery(queryValue(event, 'state', 'states')),
        revisionId: queryValue(event, 'revision_id', 'revisionId')
          ? localIdentifier(queryValue(event, 'revision_id', 'revisionId'), 'Identificador da revisão')
          : undefined,
        search: safeSearch(queryValue(event, 'search')),
        from: dateQuery(queryValue(event, 'from'), 'Data inicial'),
        to: dateQuery(queryValue(event, 'to'), 'Data final'),
        requiresAction: booleanQuery(queryValue(event, 'requires_action', 'requiresAction'), 'Filtro de ação'),
        includeActive: booleanQuery(queryValue(event, 'include_active', 'includeActive'), 'Filtro de atividade'),
        delayed: booleanQuery(queryValue(event, 'delayed'), 'Filtro de atraso'),
        page: integerQuery(queryValue(event, 'page'), 'Página', 1),
        pageSize: integerQuery(queryValue(event, 'page_size', 'pageSize'), 'Tamanho da página', 25),
      };
      if (filters.pageSize > 100) throw new HandlerInputError('Tamanho máximo da página é 100.');
      const result = await deliveryModule.list(filters);
      return json(200, {
        data: result.data.map((delivery) => toPublicDeliveryView(delivery, { includePhone: true })),
        total: result.total,
        summary: publicSummary(result.summary),
        page: filters.page,
        page_size: filters.pageSize,
      });
    }

    const body = payloadObject(event);
    if (event.httpMethod === 'POST') {
      ensureCancelPendingBody(body);
      return json(200, { cancelled: await deliveryModule.cancelPending() });
    }
    ensureResolutionBody(body);
    const location = resolutionInput(event, body);
    const resolution = resolutionBody(body);
    const delivery = location.deliveryId
      ? await deliveryModule.get({ deliveryId: location.deliveryId })
      : await deliveryModule.get({ identity: { revisionId: location.revisionId!, flowId: location.flowId! } });
    if (!delivery) return json(404, { error: 'Entrega não encontrada.' });
    const resolved = await deliveryModule.resolve({
      deliveryId: delivery.id,
      decision: resolution.decision,
      note: resolution.note,
      resolvedBy: 'authenticated-operator',
    });
    return json(200, toPublicDeliveryView(resolved, { includePhone: true }));
  } catch (error) {
    return deliveryErrorResponse(error);
  }
}

export const quotationDeliveries = handler;
