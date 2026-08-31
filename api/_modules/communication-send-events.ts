// GET /api/communication-send-events
import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  createQuotationDeliveryOutboxRepository,
  type DeliveryAggregate,
  type DeliveryListFilters,
  type DeliveryListResult,
  type QuotationDeliveryOutboxRepository,
} from '../_infrastructure/db/repositories/quotation-delivery-outbox-repository.js';
import type { DeliveryState } from './quotation-delivery-state.js';

type Handler = (event: FunctionEvent) => Promise<FunctionResult>;

export type CommunicationSendEventsList = (
  filters: DeliveryListFilters,
) => Promise<DeliveryListResult>;

export interface CommunicationSendEventsHandlerDependencies {
  list?: CommunicationSendEventsList;
  repository?: QuotationDeliveryOutboxRepository;
}

const PENDING_STATES: DeliveryState[] = [
  'queued',
  'processing',
  'provider_accepted',
  'reconciling',
  'retry_scheduled',
  'needs_review',
];

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function queryValue(event: FunctionEvent, key: string): string | undefined {
  const value = event.queryStringParameters?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function limitValue(value: string | undefined): number {
  if (value === undefined) return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed === 0) return 50;
  return Math.min(Math.max(parsed, 1), 200);
}

function statusStates(status: string | undefined): DeliveryState[] | undefined {
  if (status === 'pending') return [...PENDING_STATES];
  if (status === 'sent') return ['delivered'];
  if (status === 'failed') return ['failed'];
  return undefined;
}

function statusFor(state: string): 'pending' | 'sent' | 'failed' | 'skipped' {
  if (state === 'skipped') return 'skipped';
  if (state === 'delivered' || state === 'read') return 'sent';
  if (state === 'failed') return 'failed';
  return 'pending';
}

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapDelivery(delivery: DeliveryAggregate): Record<string, unknown> {
  const steps = Array.isArray(delivery.steps) ? delivery.steps : [];
  const stepsSent = steps.filter((step) => step.state === 'delivered' || step.state === 'read').length;
  const status = statusFor(String(delivery.state));
  const item: Record<string, unknown> = {
    id: delivery.id,
    status,
    flow_id: delivery.flowId,
    flow_name: delivery.flowName,
    quotation_id: delivery.businessNumber,
    phone: delivery.phone,
    steps_sent: stepsSent,
    steps_planned: steps.length,
    sent_at: iso(delivery.deliveredAt),
    created_at: iso(delivery.createdAt),
  };
  if (delivery.publicError) item.error_message = delivery.publicError;
  return item;
}

function deliveryTimestamp(delivery: DeliveryAggregate): number {
  const value = iso(delivery.createdAt);
  return value ? Date.parse(value) : 0;
}

function matches(
  delivery: DeliveryAggregate,
  filters: {
    quotationId?: string;
    phone?: string;
    flowId?: string;
    status?: string;
  },
): boolean {
  if (filters.quotationId && delivery.businessNumber !== filters.quotationId) return false;
  if (filters.phone && delivery.phone !== filters.phone) return false;
  if (filters.flowId && delivery.flowId !== filters.flowId) return false;
  if (
    filters.status &&
    ['pending', 'sent', 'failed', 'skipped'].includes(filters.status) &&
    statusFor(String(delivery.state)) !== filters.status
  ) {
    return false;
  }
  return true;
}

async function listDeliveries(
  list: CommunicationSendEventsList,
  params: {
    quotationId?: string;
    phone?: string;
    flowId?: string;
    status?: string;
    limit: number;
  },
): Promise<DeliveryAggregate[]> {
  // The outbox repository supports broad search and pagination. Apply the
  // history's exact filters after loading candidates so quotation_id remains
  // the commercial number rather than an internal UUID.
  const search = params.quotationId || params.phone || params.flowId;
  const states = statusStates(params.status);

  const candidates: DeliveryAggregate[] = [];
  let page = 1;
  for (;;) {
    const result = await list({ states, search, page, pageSize: 100 });
    candidates.push(...result.data);
    const matching = candidates.filter((delivery) => matches(delivery, params));
    if (matching.length >= params.limit || candidates.length >= result.total || result.data.length === 0) {
      break;
    }
    page += 1;
  }

  return candidates.filter((delivery) => matches(delivery, params));
}

export function createCommunicationSendEventsHandler(
  dependencies: CommunicationSendEventsHandlerDependencies = {},
): Handler {
  const repository = dependencies.repository || createQuotationDeliveryOutboxRepository();
  const list = dependencies.list || ((filters: DeliveryListFilters) => repository.list(filters));

  return async (event: FunctionEvent): Promise<FunctionResult> => {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' });
    try {
      const quotationId = queryValue(event, 'quotation_id');
      const phone = queryValue(event, 'phone');
      const flowId = queryValue(event, 'flow_id');
      const status = queryValue(event, 'status');
      const limit = limitValue(queryValue(event, 'limit'));
      const deliveries = await listDeliveries(list, { quotationId, phone, flowId, status, limit });
      deliveries.sort((a, b) => deliveryTimestamp(b) - deliveryTimestamp(a) || b.id.localeCompare(a.id));
      const items = deliveries.slice(0, limit).map(mapDelivery);
      return json(200, { success: true, items, total: items.length, source: 'postgres' });
    } catch (error) {
      const details = error && typeof error === 'object' ? error as Record<string, unknown> : {};
      console.error('[comm-send-events]', details.logMessage || details.message || error);
      return json(500, { error: 'Não foi possível carregar o histórico de envios.' });
    }
  };
}

export function createHandler(
  dependencies: CommunicationSendEventsHandlerDependencies = {},
): Handler {
  return createCommunicationSendEventsHandler(dependencies);
}

export const handler = createCommunicationSendEventsHandler();
