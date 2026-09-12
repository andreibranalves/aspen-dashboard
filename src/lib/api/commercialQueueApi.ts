export type OpportunityActionKind = 'first_contact';
export type OpportunityActionOrigin = 'manual' | 'automatic' | 'event';
export type OpportunityActionState = 'active' | 'completed' | 'cancelled' | 'superseded';

export interface CommercialQueueProposal {
  quotationId: string;
  businessNumber: string;
  status: string;
  total: string | null;
}

export interface CommercialQueueItem {
  actionId: string;
  opportunityId: string;
  kind: OpportunityActionKind;
  reasonCode: string;
  reasonLabel: string;
  origin: OpportunityActionOrigin;
  state: OpportunityActionState;
  dueAt: string;
  demandSummary: string | null;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  clientId: string | null;
  clientName: string | null;
  /** Every proposal linked to the demand, with value and state. */
  proposals: CommercialQueueProposal[];
}

export interface CommercialQueuePage {
  data: CommercialQueueItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CommercialQueueFilters {
  page?: number;
  pageSize?: number;
}

export class CommercialQueueApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'CommercialQueueApiError';
    this.status = status;
  }
}

const MAX_PAGE_SIZE = 100;
const MAX_TOTAL = 1_000_000;
const KINDS = ['first_contact'] as const;
const ORIGINS = ['manual', 'automatic', 'event'] as const;
const STATES = ['active', 'completed', 'cancelled', 'superseded'] as const;
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

function invalidResponse(): never {
  throw new CommercialQueueApiError('Resposta inválida da fila comercial.');
}

/** Object-shaped JSON body or a fail-closed parse error. */
function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidResponse();
  return value as Record<string, unknown>;
}

function invalidInput(message: string): never {
  throw new CommercialQueueApiError(message);
}

function text(value: unknown, maximum = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) invalidResponse();
  if (
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return (code <= 0x1f && character !== '\n' && character !== '\t') || code === 0x7f;
    })
  ) {
    invalidResponse();
  }
  return value;
}

function optionalText(value: unknown, maximum = 4000): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > maximum) invalidResponse();
  return value || null;
}

function optionalIdentifier(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return text(value, 255);
}

function timestamp(value: unknown): string {
  const result = text(value, 80);
  if (!ISO_TIMESTAMP.test(result) || Number.isNaN(Date.parse(result))) invalidResponse();
  return result;
}

function member<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value))
    invalidResponse();
  return value as T;
}

function pageInteger(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalidResponse();
  }
  return value;
}

function parseProposal(value: unknown): CommercialQueueProposal {
  const record = asObject(value);
  return {
    quotationId: text(record.quotation_id, 255),
    businessNumber: text(record.business_number, 32),
    status: text(record.status, 32),
    total: optionalText(record.total, 64),
  };
}

export function parseCommercialQueueItem(value: unknown): CommercialQueueItem {
  const record = asObject(value);
  if (!Array.isArray(record.proposals)) invalidResponse();
  return {
    actionId: text(record.action_id, 255),
    opportunityId: text(record.opportunity_id, 255),
    kind: member(record.kind, KINDS),
    reasonCode: text(record.reason_code, 100),
    reasonLabel: text(record.reason_label, 255),
    origin: member(record.origin, ORIGINS),
    state: member(record.state, STATES),
    dueAt: timestamp(record.due_at),
    demandSummary: optionalText(record.demand_summary),
    contactName: text(record.contact_name, 255),
    contactPhone: optionalText(record.contact_phone, 32),
    contactEmail: optionalText(record.contact_email, 254),
    clientId: optionalIdentifier(record.client_id),
    clientName: optionalIdentifier(record.client_name),
    proposals: record.proposals.map(parseProposal),
  };
}

export function parseCommercialQueuePage(value: unknown): CommercialQueuePage {
  const record = asObject(value);
  if (!Array.isArray(record.data) || record.data.length > MAX_PAGE_SIZE) invalidResponse();
  const page = pageInteger(record.page, 1, MAX_TOTAL);
  const pageSize = pageInteger(record.page_size, 1, MAX_PAGE_SIZE);
  const total = pageInteger(record.total, 0, MAX_TOTAL);
  if (record.data.length > pageSize || total < record.data.length) invalidResponse();
  return { data: record.data.map(parseCommercialQueueItem), total, page, pageSize };
}

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null) return fallback;
  const message = (value as { error?: unknown }).error;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

export async function listCommercialQueue(
  filters: CommercialQueueFilters = {}
): Promise<CommercialQueuePage> {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;
  if (!Number.isSafeInteger(page) || page < 1 || page > MAX_TOTAL) invalidInput('Página inválida.');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    invalidInput('Tamanho da página inválido.');
  }
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  const response = await fetch(`/api/commercial-queue?${query.toString()}`, { method: 'GET' });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new CommercialQueueApiError(
      errorMessage(body, 'Não foi possível carregar a fila comercial.'),
      response.status
    );
  }
  return parseCommercialQueuePage(body);
}
