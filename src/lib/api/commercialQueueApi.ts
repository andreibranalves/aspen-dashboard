export type OpportunityActionKind =
  | 'first_contact'
  | 'internal'
  | 'customer_contact'
  | 'agreed_commitment'
  | 'review';
export type OpportunityActionOrigin = 'manual' | 'automatic' | 'event';
export type OpportunityActionState = 'active' | 'completed' | 'cancelled' | 'superseded';
export type OpportunityActionScheduleType = 'date_only' | 'timed';
export type OpportunityActionDueStatus = 'upcoming' | 'today' | 'overdue' | 'closed';
export type CommercialQueueFilter = 'active' | 'overdue' | 'today' | 'scheduled' | 'closed';
export type CommercialQueueContactContextStatus = 'available' | 'unavailable' | 'review';
export type CommercialQueueContactDirection = 'inbound' | 'outbound' | null;

export interface CommercialQueueProposal {
  quotationId: string;
  businessNumber: string;
  status: string;
  total: string | null;
}

export interface CommercialQueueBlocker {
  code: string;
  label: string;
}

export interface CommercialQueueContactContext {
  status: CommercialQueueContactContextStatus;
  lastContactAt: string | null;
  lastContactDirection: CommercialQueueContactDirection;
  blockers: CommercialQueueBlocker[];
}

export interface CommercialQueueItem {
  actionId: string;
  opportunityId: string;
  kind: OpportunityActionKind;
  kindLabel: string;
  reasonCode: string;
  reason: string | null;
  reasonLabel: string;
  origin: OpportunityActionOrigin;
  state: OpportunityActionState;
  dueAt: string;
  dueDate: string | null;
  dueTime: string | null;
  scheduleType: OpportunityActionScheduleType;
  dueStatus: OpportunityActionDueStatus;
  version: number;
  actor: string;
  isUrgent: boolean;
  priority: number;
  opportunityStatus: string;
  terminalStatus: string | null;
  terminalReason: string | null;
  terminalAt: string | null;
  contactContext: CommercialQueueContactContext;
  whatsappHref: string | null;
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
  filter?: CommercialQueueFilter;
}

export interface CommercialActionScheduleInput {
  kind: OpportunityActionKind;
  dueDate: string;
  dueTime: string | null;
  reason: string;
}

export interface CommercialActionCommandResult {
  actionId: string;
  opportunityId: string;
  state: OpportunityActionState;
  version: number;
  closed: boolean;
  successor: {
    actionId: string;
    opportunityId: string;
    kind: OpportunityActionKind;
    reason: string;
    origin: OpportunityActionOrigin;
    state: OpportunityActionState;
    dueAt: string;
    dueDate: string;
    dueTime: string | null;
    scheduleType: OpportunityActionScheduleType;
    version: number;
  } | null;
}

export interface CommercialUrgencyResult {
  opportunityId: string;
  actionId: string;
  version: number;
  isUrgent: boolean;
}

export interface CommercialActionHistoryEntry {
  eventId: string;
  actionId: string;
  type: 'created' | 'rescheduled' | 'completed' | 'replaced';
  actor: string;
  timestamp: string;
  origin: OpportunityActionOrigin;
  reason: string;
  state: OpportunityActionState;
  replacementActionId: string | null;
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
const KINDS = [
  'first_contact',
  'internal',
  'customer_contact',
  'agreed_commitment',
  'review',
] as const;
const ORIGINS = ['manual', 'automatic', 'event'] as const;
const STATES = ['active', 'completed', 'cancelled', 'superseded'] as const;
const SCHEDULE_TYPES = ['date_only', 'timed'] as const;
const DUE_STATUSES = ['upcoming', 'today', 'overdue', 'closed'] as const;
const FILTERS = ['active', 'overdue', 'today', 'scheduled', 'closed'] as const;
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

function optionalDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) invalidResponse();
  return result;
}

function optionalTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const result = text(value, 8);
  if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(result)) invalidResponse();
  return result.slice(0, 5);
}

function optionalNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  return pageInteger(value, 1, MAX_TOTAL);
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

function parseContactContext(value: unknown, record: Record<string, unknown>): CommercialQueueContactContext {
  const source = value === undefined ? record : asObject(value);
  const status = source.status;
  const normalizedStatus: CommercialQueueContactContextStatus =
    status === 'available' || status === 'review' ? status : 'unavailable';
  const direction = source.last_contact_direction;
  return {
    status: normalizedStatus,
    lastContactAt:
      source.last_contact_at === null || source.last_contact_at === undefined
        ? null
        : timestamp(source.last_contact_at),
    lastContactDirection:
      direction === 'inbound' || direction === 'outbound' ? direction : null,
    blockers: Array.isArray(source.blockers)
      ? source.blockers.map((entry) => {
          const blocker = asObject(entry);
          return { code: text(blocker.code, 64), label: text(blocker.label, 255) };
        })
      : [],
  };
}

export function parseCommercialQueueItem(value: unknown): CommercialQueueItem {
  const record = asObject(value);
  if (!Array.isArray(record.proposals)) invalidResponse();
  return {
    actionId: text(record.action_id, 255),
    opportunityId: text(record.opportunity_id, 255),
    kind: member(record.kind, KINDS),
    kindLabel:
      typeof record.kind_label === 'string' && record.kind_label.trim()
        ? record.kind_label
        : String(record.kind),
    reasonCode: text(record.reason_code, 100),
    reason: optionalText(record.reason, 500),
    reasonLabel: text(record.reason_label, 255),
    origin: member(record.origin, ORIGINS),
    state: member(record.state, STATES),
    dueAt: timestamp(record.due_at),
    dueDate: optionalDate(record.due_date),
    dueTime: optionalTime(record.due_time),
    scheduleType:
      record.schedule_type === undefined
        ? 'timed'
        : member(record.schedule_type, SCHEDULE_TYPES),
    dueStatus:
      record.due_status === undefined ? 'upcoming' : member(record.due_status, DUE_STATUSES),
    version: optionalNumber(record.version, 1),
    actor:
      typeof record.actor === 'string' && record.actor.trim() ? record.actor : 'legacy-system',
    isUrgent: record.is_urgent === true,
    priority: record.priority === undefined ? 8 : optionalNumber(record.priority, 8),
    opportunityStatus: optionalText(record.opportunity_status, 32) || '',
    terminalStatus: optionalText(record.terminal_status, 32),
    terminalReason: optionalText(record.terminal_reason, 500),
    terminalAt:
      record.terminal_at === null || record.terminal_at === undefined
        ? null
        : timestamp(record.terminal_at),
    contactContext: parseContactContext(record.contact_context, record),
    whatsappHref: optionalText(record.whatsapp_href, 500),
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
  const filter = filters.filter ?? 'active';
  if (!(FILTERS as readonly string[]).includes(filter)) invalidInput('Filtro inválido.');
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    filter,
  });
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

function parseUrgencyResult(value: unknown): CommercialUrgencyResult {
  const record = asObject(value);
  return {
    opportunityId: text(record.opportunity_id, 255),
    actionId: text(record.action_id, 255),
    version: optionalNumber(record.version, 1),
    isUrgent: record.is_urgent === true,
  };
}

export function setCommercialUrgency(input: {
  opportunityId: string;
  actionId: string;
  expectedVersion: number;
  isUrgent: boolean;
}): Promise<CommercialUrgencyResult> {
  return sendActionBody({
    command: 'set_urgency',
    opportunity_id: input.opportunityId,
    action_id: input.actionId,
    expected_version: input.expectedVersion,
    is_urgent: input.isUrgent,
  }).then(parseUrgencyResult);
}

function parseCommandResult(value: unknown): CommercialActionCommandResult {
  const record = asObject(value);
  const successorValue = record.successor;
  let successor: CommercialActionCommandResult['successor'] = null;
  if (successorValue !== null && successorValue !== undefined) {
    const item = asObject(successorValue);
    successor = {
      actionId: text(item.action_id, 255),
      opportunityId: text(item.opportunity_id, 255),
      kind: member(item.kind, KINDS),
      reason: text(item.reason, 500),
      origin: member(item.origin, ORIGINS),
      state: member(item.state, STATES),
      dueAt: timestamp(item.due_at),
      dueDate: text(item.due_date, 10),
      dueTime: optionalTime(item.due_time),
      scheduleType: member(item.schedule_type, SCHEDULE_TYPES),
      version: optionalNumber(item.version, 1),
    };
  }
  return {
    actionId: text(record.action_id, 255),
    opportunityId: text(record.opportunity_id, 255),
    state: member(record.state, STATES),
    version: optionalNumber(record.version, 1),
    closed: record.closed === true,
    successor,
  };
}

async function sendActionBody(payload: Record<string, unknown>): Promise<unknown> {
  const response = await fetch('/api/commercial-queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new CommercialQueueApiError(
      errorMessage(body, 'Não foi possível atualizar a próxima ação.'),
      response.status
    );
  }
  return body;
}

async function sendAction(payload: Record<string, unknown>): Promise<CommercialActionCommandResult> {
  return parseCommandResult(await sendActionBody(payload));
}

function schedulePayload(input: CommercialActionScheduleInput): Record<string, unknown> {
  return {
    kind: input.kind,
    due_date: input.dueDate,
    due_time: input.dueTime,
    reason: input.reason,
  };
}

export function createCommercialAction(
  input: CommercialActionScheduleInput & {
    opportunityId: string;
    replaceActionId?: string;
    expectedVersion?: number;
  }
): Promise<CommercialActionCommandResult> {
  return sendAction({
    command: 'create',
    opportunity_id: input.opportunityId,
    ...(input.replaceActionId ? { replace_action_id: input.replaceActionId } : {}),
    ...(input.expectedVersion ? { expected_version: input.expectedVersion } : {}),
    ...schedulePayload(input),
  });
}

export function rescheduleCommercialAction(
  input: CommercialActionScheduleInput & { actionId: string; expectedVersion: number }
): Promise<CommercialActionCommandResult> {
  return sendAction({
    command: 'reschedule',
    action_id: input.actionId,
    expected_version: input.expectedVersion,
    ...schedulePayload(input),
  });
}

export type CommercialActionCompletion =
  | { successor: CommercialActionScheduleInput }
  | { closeReason: string };

export function completeCommercialAction(
  input:
    & { actionId: string; expectedVersion: number }
    & (CommercialActionCompletion | { outcome: CommercialActionCompletion })
): Promise<CommercialActionCommandResult> {
  const selected = 'outcome' in input ? input.outcome : input;
  const outcome = 'successor' in selected
    ? { successor: schedulePayload(selected.successor) }
    : { close: { reason: selected.closeReason } };
  return sendAction({
    command: 'complete',
    action_id: input.actionId,
    expected_version: input.expectedVersion,
    ...outcome,
  });
}

function parseHistoryEntry(value: unknown): CommercialActionHistoryEntry {
  const record = asObject(value);
  return {
    eventId: text(record.event_id, 255),
    actionId: text(record.action_id, 255),
    type: member(record.type, ['created', 'rescheduled', 'completed', 'replaced'] as const),
    actor: text(record.actor, 128),
    timestamp: timestamp(record.timestamp),
    origin: member(record.origin, ORIGINS),
    reason: text(record.reason, 500),
    state: member(record.state, STATES),
    replacementActionId:
      record.replacement_action_id === null || record.replacement_action_id === undefined
        ? null
        : text(record.replacement_action_id, 255),
  };
}

export async function getCommercialActionHistory(
  opportunityId: string
): Promise<CommercialActionHistoryEntry[]> {
  const query = new URLSearchParams({ opportunity_id: opportunityId, view: 'history' });
  const response = await fetch(`/api/commercial-queue?${query.toString()}`, { method: 'GET' });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new CommercialQueueApiError(
      errorMessage(body, 'Não foi possível carregar o histórico da ação.'),
      response.status
    );
  }
  const record = asObject(body);
  if (!Array.isArray(record.data)) invalidResponse();
  return record.data.map(parseHistoryEntry);
}
