export type DeliveryState =
  | 'queued'
  | 'processing'
  | 'provider_accepted'
  | 'reconciling'
  | 'retry_scheduled'
  | 'needs_review'
  | 'delivered'
  | 'failed';

export type DeliveryIdentity = { revisionId: string; flowId: string };
export type DeliveryResolution = 'confirmed_received' | 'confirmed_not_received';

export interface DeliveryListFilters {
  states?: DeliveryState[];
  search?: string;
  from?: string;
  to?: string;
  requiresAction?: boolean;
  includeActive?: boolean;
  delayed?: boolean;
  page: number;
  pageSize: number;
}

export interface DeliveryStepView {
  id: string;
  position: number;
  type: 'text' | 'media' | 'quotation_pdf';
  state:
    | 'queued'
    | 'sending'
    | 'server_ack'
    | 'reconciling'
    | 'retry_scheduled'
    | 'needs_review'
    | 'delivered'
    | 'read'
    | 'failed';
  attemptCount: number;
  publicError: string | null;
  updatedAt: string;
}

export interface DeliveryPage {
  data: DeliveryView[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    active: number;
    requiresAction: number;
    retryScheduled: number;
    delayed: number;
    deliveredLast24Hours: number;
  };
}

export interface DeliveryView {
  id: string;
  revisionId: string;
  businessNumber: string;
  clientName: string;
  phone: string;
  flowId: string;
  flowName: string;
  state: DeliveryState;
  publicError: string | null;
  completionSource: 'provider_receipt' | 'operator' | 'legacy_provider_ack' | null;
  progress: { delivered: number; total: number };
  steps: DeliveryStepView[];
  nextAttemptAt: string | null;
  reconciliationDeadline: string | null;
  deliveredAt: string | null;
  updatedAt: string;
}

export interface DeliveryProjection {
  label: string;
  requiresAction: boolean;
}

export class QuotationDeliveryApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'QuotationDeliveryApiError';
    this.status = status;
  }
}

const DELIVERY_STATES = [
  'queued',
  'processing',
  'provider_accepted',
  'reconciling',
  'retry_scheduled',
  'needs_review',
  'delivered',
  'failed',
] as const satisfies readonly DeliveryState[];

const DELIVERY_STEP_STATES = [
  'queued',
  'sending',
  'server_ack',
  'reconciling',
  'retry_scheduled',
  'needs_review',
  'delivered',
  'read',
  'failed',
] as const satisfies readonly DeliveryStepView['state'][];

const COMPLETION_SOURCES = ['provider_receipt', 'operator', 'legacy_provider_ack'] as const;

const MAX_PAGE_SIZE = 100;
const MAX_PAGE_TOTAL = 1_000_000;
const MAX_STEPS = 100;
const MAX_ATTEMPTS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalidResponse(): never {
  throw new QuotationDeliveryApiError('Resposta inválida da entrega WhatsApp.');
}

function invalidInput(message: string): never {
  throw new QuotationDeliveryApiError(message);
}

function text(value: unknown, options: { required?: boolean; maximum?: number } = {}): string {
  if (typeof value !== 'string') invalidResponse();
  if (options.required !== false && !value.trim()) invalidResponse();
  if (options.maximum !== undefined && value.length > options.maximum) invalidResponse();
  if (
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  )
    invalidResponse();
  return value;
}

function inputIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string') invalidInput(`${label} inválido.`);
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 255 ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    invalidInput(`${label} inválido.`);
  }
  return normalized;
}

function integer(value: unknown, options: { minimum: number; maximum: number }): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < options.minimum ||
    value > options.maximum
  ) {
    invalidResponse();
  }
  return value;
}

function inputInteger(value: unknown, label: string, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    invalidInput(`${label} inválida.`);
  }
  return value;
}

function timestamp(value: unknown): string {
  const result = text(value);
  if (Number.isNaN(Date.parse(result))) invalidResponse();
  return result;
}

function nullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  return timestamp(value);
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalidResponse();
  return value as T;
}

function parseStep(value: unknown): DeliveryStepView {
  if (!isRecord(value)) invalidResponse();
  return {
    id: text(value.id, { maximum: 255 }),
    position: integer(value.position, { minimum: 0, maximum: MAX_STEPS - 1 }),
    type: oneOf(value.type, ['text', 'media', 'quotation_pdf']),
    state: oneOf(value.state, DELIVERY_STEP_STATES),
    attemptCount: integer(value.attempt_count, { minimum: 0, maximum: MAX_ATTEMPTS }),
    publicError:
      value.public_error === null
        ? null
        : text(value.public_error, { required: false, maximum: 500 }),
    updatedAt: timestamp(value.updated_at),
  };
}

function parseDelivery(
  value: unknown,
  options: { allowMissingPhone?: boolean } = {}
): DeliveryView {
  if (!isRecord(value) || !Array.isArray(value.steps) || value.steps.length > MAX_STEPS)
    invalidResponse();
  const progress = value.progress;
  if (!isRecord(progress)) invalidResponse();
  const steps = value.steps.map(parseStep);
  const total = integer(progress.total, { minimum: 0, maximum: MAX_STEPS });
  const delivered = integer(progress.delivered, { minimum: 0, maximum: total });
  if (total !== steps.length || steps.some((step, index) => step.position !== index))
    invalidResponse();
  const phone =
    options.allowMissingPhone && value.phone === undefined
      ? ''
      : text(value.phone, { maximum: 255 });
  return {
    id: text(value.id, { maximum: 255 }),
    revisionId: text(value.revision_id, { maximum: 255 }),
    businessNumber: text(value.business_number, { maximum: 255 }),
    clientName: text(value.client_name, { maximum: 255 }),
    phone,
    flowId: text(value.flow_id, { maximum: 255 }),
    flowName: text(value.flow_name, { maximum: 255 }),
    state: oneOf(value.state, DELIVERY_STATES),
    publicError:
      value.public_error === null
        ? null
        : text(value.public_error, { required: false, maximum: 500 }),
    completionSource:
      value.completion_source === null ? null : oneOf(value.completion_source, COMPLETION_SOURCES),
    progress: { delivered, total },
    steps,
    nextAttemptAt: nullableTimestamp(value.next_attempt_at),
    reconciliationDeadline: nullableTimestamp(value.reconciliation_deadline),
    deliveredAt: nullableTimestamp(value.delivered_at),
    updatedAt: timestamp(value.updated_at),
  };
}

function parseSummary(value: unknown): DeliveryPage['summary'] {
  if (!isRecord(value)) invalidResponse();
  return {
    active: integer(value.active, { minimum: 0, maximum: MAX_PAGE_TOTAL }),
    requiresAction: integer(value.requires_action, { minimum: 0, maximum: MAX_PAGE_TOTAL }),
    retryScheduled: integer(value.retry_scheduled, { minimum: 0, maximum: MAX_PAGE_TOTAL }),
    delayed: integer(value.delayed, { minimum: 0, maximum: MAX_PAGE_TOTAL }),
    deliveredLast24Hours: integer(value.delivered_last_24_hours, {
      minimum: 0,
      maximum: MAX_PAGE_TOTAL,
    }),
  };
}

function parsePage(value: unknown): DeliveryPage {
  if (!isRecord(value) || !Array.isArray(value.data) || value.data.length > MAX_PAGE_SIZE)
    invalidResponse();
  const page = integer(value.page, { minimum: 1, maximum: MAX_PAGE_TOTAL });
  const pageSize = integer(value.page_size, { minimum: 1, maximum: MAX_PAGE_SIZE });
  if (value.data.length > pageSize) invalidResponse();
  const total = integer(value.total, { minimum: 0, maximum: MAX_PAGE_TOTAL });
  if (total < value.data.length) invalidResponse();
  return {
    data: value.data.map((item) => parseDelivery(item)),
    total,
    page,
    pageSize,
    summary: parseSummary(value.summary),
  };
}

function errorMessage(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === 'string' && value.error.trim()
    ? value.error
    : fallback;
}

async function responseBody(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

async function requestError(response: Response, fallback: string): Promise<never> {
  const body = await responseBody(response);
  throw new QuotationDeliveryApiError(errorMessage(body, fallback), response.status);
}

function queryForIdentity(identity: DeliveryIdentity): string {
  const revisionId = inputIdentifier(identity.revisionId, 'Identificador da revisão');
  const flowId = inputIdentifier(identity.flowId, 'Fluxo');
  return new URLSearchParams({ revision_id: revisionId, flow_id: flowId }).toString();
}

function parseStatusResponse(value: unknown, identity: DeliveryIdentity): { deliveryId: string } {
  if (!isRecord(value)) invalidResponse();
  const revisionId = text(value.revision_id, { maximum: 255 });
  const flowId = text(value.flow_id, { maximum: 255 });
  const deliveryId = text(value.delivery_id, { maximum: 255 });
  oneOf(value.phase, DELIVERY_STATES);
  if (revisionId !== identity.revisionId || flowId !== identity.flowId) invalidResponse();
  if (value.error !== null) text(value.error, { required: false, maximum: 500 });
  timestamp(value.updated_at);
  return { deliveryId };
}

export function projectDelivery(delivery: DeliveryView): DeliveryProjection {
  const labels: Record<DeliveryState, string> = {
    queued: 'Na fila',
    processing: 'Enviando',
    provider_accepted: 'Aceito pela Evolution',
    reconciling: 'Reconciliação em andamento',
    retry_scheduled: 'Nova tentativa agendada',
    needs_review: 'Revisão necessária',
    delivered: 'Entregue',
    failed: 'Falhou',
  };
  const delayed =
    delivery.state === 'provider_accepted' &&
    delivery.reconciliationDeadline !== null &&
    Date.parse(delivery.reconciliationDeadline) <= Date.now();
  return {
    label: labels[delivery.state],
    requiresAction: delivery.state === 'needs_review' || delayed,
  };
}

export function deliveryPollDelay(state: DeliveryState): number | null {
  if (!DELIVERY_STATES.includes(state)) invalidInput('Estado de entrega inválido.');
  switch (state) {
    case 'queued':
    case 'processing':
      return 1_500;
    case 'provider_accepted':
    case 'reconciling':
      return 5_000;
    case 'retry_scheduled':
      return 15_000;
    case 'needs_review':
    case 'delivered':
    case 'failed':
      return null;
  }
}

export async function fetchDelivery(
  identityOrId: DeliveryIdentity | { id: string }
): Promise<DeliveryView | null> {
  if ('id' in identityOrId) {
    const id = inputIdentifier(identityOrId.id, 'Identificador da entrega');
    const response = await fetch(`/api/quotation-deliveries?id=${encodeURIComponent(id)}`);
    if (response.status === 404) return null;
    if (!response.ok) return requestError(response, 'Não foi possível consultar a entrega.');
    return parseDelivery(await responseBody(response));
  }

  const identity: DeliveryIdentity = {
    revisionId: inputIdentifier(identityOrId.revisionId, 'Identificador da revisão'),
    flowId: inputIdentifier(identityOrId.flowId, 'Fluxo'),
  };
  const statusResponse = await fetch(`/api/whatsapp-send-status?${queryForIdentity(identity)}`);
  if (statusResponse.status === 404) return null;
  if (!statusResponse.ok)
    return requestError(statusResponse, 'Não foi possível consultar a entrega.');
  const status = parseStatusResponse(await responseBody(statusResponse), identity);
  return fetchDelivery({ id: status.deliveryId });
}

export async function listDeliveries(filters: DeliveryListFilters): Promise<DeliveryPage> {
  const page = inputInteger(filters.page, 'Página', MAX_PAGE_TOTAL);
  const pageSize = inputInteger(filters.pageSize, 'Tamanho da página', MAX_PAGE_SIZE);
  if (!Array.isArray(filters.states) && filters.states !== undefined) {
    invalidInput('Estados de entrega inválidos.');
  }
  if (filters.states?.some((state) => !DELIVERY_STATES.includes(state))) {
    invalidInput('Estados de entrega inválidos.');
  }
  if (filters.search !== undefined && typeof filters.search !== 'string')
    invalidInput('Busca inválida.');
  if (
    filters.search !== undefined &&
    (filters.search.length > 255 ||
      [...filters.search].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
      }))
  )
    invalidInput('Busca inválida.');
  if (
    filters.from !== undefined &&
    (typeof filters.from !== 'string' || Number.isNaN(Date.parse(filters.from)))
  )
    invalidInput('Data inicial inválida.');
  if (
    filters.to !== undefined &&
    (typeof filters.to !== 'string' || Number.isNaN(Date.parse(filters.to)))
  )
    invalidInput('Data final inválida.');
  for (const value of [filters.requiresAction, filters.includeActive, filters.delayed]) {
    if (value !== undefined && typeof value !== 'boolean')
      invalidInput('Filtro booleano inválido.');
  }
  if (
    filters.from !== undefined &&
    filters.to !== undefined &&
    Date.parse(filters.from) > Date.parse(filters.to)
  ) {
    invalidInput('Período inválido.');
  }

  const params = new URLSearchParams();
  if (filters.states?.length) params.set('state', [...new Set(filters.states)].join(','));
  if (filters.search !== undefined) params.set('search', filters.search);
  if (filters.from !== undefined) params.set('from', filters.from);
  if (filters.to !== undefined) params.set('to', filters.to);
  if (filters.requiresAction !== undefined)
    params.set('requires_action', String(filters.requiresAction));
  if (filters.includeActive !== undefined)
    params.set('include_active', String(filters.includeActive));
  if (filters.delayed !== undefined) params.set('delayed', String(filters.delayed));
  params.set('page', String(page));
  params.set('page_size', String(pageSize));

  const response = await fetch(`/api/quotation-deliveries?${params.toString()}`);
  if (!response.ok) return requestError(response, 'Não foi possível consultar as entregas.');
  return parsePage(await responseBody(response));
}

export async function enqueueDelivery(
  input: DeliveryIdentity & { quotationId: string }
): Promise<DeliveryView> {
  const quotationId = inputIdentifier(input.quotationId, 'Identificador do orçamento');
  const revisionId = inputIdentifier(input.revisionId, 'Identificador da revisão');
  const flowId = inputIdentifier(input.flowId, 'Fluxo');
  const response = await fetch('/api/send-whatsapp-flow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quotation_id: quotationId, revision_id: revisionId, flow_id: flowId }),
  });
  if (!response.ok) return requestError(response, 'Não foi possível iniciar o envio.');
  const body = await responseBody(response);
  if (!isRecord(body) || body.success !== true || !isRecord(body.delivery)) invalidResponse();
  const deliveryId = text(body.delivery_id, { maximum: 255 });
  const responseRevisionId = text(body.revision_id, { maximum: 255 });
  const responseFlowId = text(body.flow_id, { maximum: 255 });
  const sendStatus = oneOf(body.send_status, DELIVERY_STATES);
  const delivery = parseDelivery(body.delivery, { allowMissingPhone: true });
  if (
    responseRevisionId !== revisionId ||
    responseFlowId !== flowId ||
    delivery.id !== deliveryId ||
    delivery.revisionId !== revisionId ||
    delivery.flowId !== flowId ||
    delivery.state !== sendStatus
  ) {
    invalidResponse();
  }
  // The enqueue response intentionally omits recipient PII. Detail/list responses include it.
  return delivery;
}

export async function resolveDelivery(
  id: string,
  decision: DeliveryResolution,
  note: string
): Promise<DeliveryView> {
  const deliveryId = inputIdentifier(id, 'Identificador da entrega');
  if (decision !== 'confirmed_received' && decision !== 'confirmed_not_received') {
    invalidInput('Decisão de resolução inválida.');
  }
  if (
    typeof note !== 'string' ||
    note.trim().length < 3 ||
    note.trim().length > 500 ||
    [...note].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    invalidInput('Justificativa inválida.');
  }
  const response = await fetch(`/api/quotation-deliveries?id=${encodeURIComponent(deliveryId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, note: note.trim() }),
  });
  if (!response.ok) return requestError(response, 'Não foi possível resolver a entrega.');
  return parseDelivery(await responseBody(response));
}
