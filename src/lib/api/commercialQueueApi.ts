export type OpportunityActionKind =
  | 'first_contact'
  | 'internal'
  | 'customer_contact'
  | 'agreed_commitment'
  | 'review';
export type OpportunityActionOrigin = 'manual' | 'automatic' | 'event';
export type OpportunityActionState =
  | 'active'
  | 'suspended'
  | 'completed'
  | 'cancelled'
  | 'superseded';
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
  followUpStage: number;
  opportunityStatus: string;
  terminalStatus: string | null;
  terminalReason: string | null;
  terminalAt: string | null;
  contactContext: CommercialQueueContactContext;
  whatsappHref: string | null;
  demandSummary: string | null;
  contactName: string;
  contactPhone: string | null;
  blockedContactPhone: string | null;
  contactEmail: string | null;
  clientId: string | null;
  clientName: string | null;
  sourceQuotationId: string | null;
  sourceRevisionId: string | null;
  sourceDeliveryId: string | null;
  /** Every proposal linked to the demand, with value and state. */
  proposals: CommercialQueueProposal[];
  associationCandidates: Array<{ opportunityId: string; demandSummary: string | null }>;
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

export type CommercialFollowUpBusinessDays = 2 | 3;

export interface CommercialFollowUpSuggestion {
  anchorDate: string;
  suggestedDate: string;
  businessDays: CommercialFollowUpBusinessDays;
}

export interface CommercialActionScheduleInput {
  kind: OpportunityActionKind;
  dueDate: string;
  dueTime: string | null;
  reason: string;
}

export type CommercialManualContactType = 'phone_call' | 'external_conversation';
export type CommercialManualContactResultCode =
  | 'follow_up_agreed'
  | 'interested'
  | 'not_interested'
  | 'no_response'
  | 'awaiting_information'
  | 'wrong_contact'
  | 'other';
export type CommercialManualContactContinuationType = 'successor' | 'wait' | 'close';
export type CommercialFollowUpContinuityType = 'new_cycle' | 'manual_date';

export type CommercialManualContactContinuation =
  | { type: 'successor'; schedule: CommercialActionScheduleInput }
  | { type: 'wait'; schedule: CommercialActionScheduleInput }
  | { type: 'close'; closeReason: string };

export interface CommercialManualContactInput {
  commandId: string;
  opportunityId: string;
  actionId: string;
  expectedVersion: number;
  contactType: CommercialManualContactType;
  occurredAt: string;
  note: string | null;
  resultCode: CommercialManualContactResultCode;
  countsAsFollowUp: boolean;
  continuation: CommercialManualContactContinuation;
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

export interface CommercialManualContactResult extends CommercialActionCommandResult {
  eventId: string;
  commandId: string;
  contactType: CommercialManualContactType;
  occurredAt: string;
  note: string | null;
  resultCode: CommercialManualContactResultCode;
  countsAsFollowUp: boolean;
  continuationType: CommercialManualContactContinuationType;
  source: 'operator_statement';
}

export interface CommercialFollowUpContinuityInput {
  commandId: string;
  opportunityId: string;
  actionId: string;
  expectedVersion: number;
  type: CommercialFollowUpContinuityType;
  schedule: CommercialActionScheduleInput;
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
  type: 'created' | 'rescheduled' | 'completed' | 'replaced' | 'manual_contact';
  actor: string;
  timestamp: string;
  origin: OpportunityActionOrigin;
  reason: string;
  state: OpportunityActionState;
  replacementActionId: string | null;
  contactType?: CommercialManualContactType;
  occurredAt?: string;
  note?: string | null;
  resultCode?: CommercialManualContactResultCode;
  resultLabel?: string;
  countsAsFollowUp?: boolean;
  source?: 'operator_statement';
  continuationType?: CommercialManualContactContinuationType;
  successorActionId?: string | null;
  closeReason?: string | null;
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
const STATES = ['active', 'suspended', 'completed', 'cancelled', 'superseded'] as const;
const SCHEDULE_TYPES = ['date_only', 'timed'] as const;
const DUE_STATUSES = ['upcoming', 'today', 'overdue', 'closed'] as const;
const FILTERS = ['active', 'overdue', 'today', 'scheduled', 'closed'] as const;
const MANUAL_CONTACT_TYPES = ['phone_call', 'external_conversation'] as const;
const MANUAL_CONTACT_RESULTS = [
  'follow_up_agreed',
  'interested',
  'not_interested',
  'no_response',
  'awaiting_information',
  'wrong_contact',
  'other',
] as const;
const MANUAL_CONTACT_CONTINUATIONS = ['successor', 'wait', 'close'] as const;
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
  const match = ISO_TIMESTAMP.exec(result);
  if (!match) invalidResponse();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth =
    month === 2
      ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
        ? 29
        : 28
      : [4, 6, 9, 11].includes(month)
        ? 30
        : 31;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    Number(match[4]) > 23 ||
    Number(match[5]) > 59 ||
    Number(match[6]) > 59 ||
    (match[7] !== 'Z' && (Number(match[9]) > 23 || Number(match[10]) > 59)) ||
    Number.isNaN(Date.parse(result))
  ) {
    invalidResponse();
  }
  return result;
}

function optionalDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) invalidResponse();
  return result;
}

function strictDate(value: unknown): string {
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) invalidResponse();
  const [year, month, day] = result.split('-').map(Number);
  const millis = Date.UTC(year, month - 1, day);
  if (new Date(millis).toISOString().slice(0, 10) !== result) invalidResponse();
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

function parseContactContext(
  value: unknown,
  record: Record<string, unknown>
): CommercialQueueContactContext {
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
    lastContactDirection: direction === 'inbound' || direction === 'outbound' ? direction : null,
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
  const associationCandidates = record.association_candidates ?? [];
  if (!Array.isArray(associationCandidates)) invalidResponse();
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
      record.schedule_type === undefined ? 'timed' : member(record.schedule_type, SCHEDULE_TYPES),
    dueStatus:
      record.due_status === undefined ? 'upcoming' : member(record.due_status, DUE_STATUSES),
    version: optionalNumber(record.version, 1),
    actor: typeof record.actor === 'string' && record.actor.trim() ? record.actor : 'legacy-system',
    isUrgent: record.is_urgent === true,
    priority: record.priority === undefined ? 8 : optionalNumber(record.priority, 8),
    followUpStage: pageInteger(record.follow_up_stage, 0, MAX_TOTAL),
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
    blockedContactPhone: optionalText(record.blocked_contact_phone, 32),
    contactEmail: optionalText(record.contact_email, 254),
    clientId: optionalIdentifier(record.client_id),
    clientName: optionalIdentifier(record.client_name),
    sourceQuotationId: optionalIdentifier(record.source_quotation_id),
    sourceRevisionId: optionalIdentifier(record.source_revision_id),
    sourceDeliveryId: optionalIdentifier(record.source_delivery_id),
    proposals: record.proposals.map(parseProposal),
    associationCandidates: associationCandidates.map((value) => {
      const candidate = asObject(value);
      return {
        opportunityId: text(candidate.opportunity_id, 255),
        demandSummary: optionalText(candidate.demand_summary),
      };
    }),
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

export async function getCommercialFollowUpSuggestion(input: {
  occurredAt: string;
  businessDays: CommercialFollowUpBusinessDays;
  signal?: AbortSignal;
}): Promise<CommercialFollowUpSuggestion> {
  timestamp(input.occurredAt);
  if (input.businessDays !== 2 && input.businessDays !== 3) {
    invalidInput('A quantidade de dias úteis é inválida.');
  }
  const query = new URLSearchParams({
    view: 'follow_up_suggestion',
    occurred_at: input.occurredAt,
    business_days: String(input.businessDays),
  });
  const response = await fetch(`/api/commercial-queue?${query.toString()}`, {
    method: 'GET',
    signal: input.signal,
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new CommercialQueueApiError(
      errorMessage(body, 'Não foi possível calcular a sugestão de retorno.'),
      response.status
    );
  }
  const record = asObject(body);
  const businessDays = pageInteger(record.business_days, 2, 3) as CommercialFollowUpBusinessDays;
  if (businessDays !== input.businessDays) invalidResponse();
  return {
    anchorDate: strictDate(record.anchor_date),
    suggestedDate: strictDate(record.suggested_date),
    businessDays,
  };
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

export function associateCommercialInbound(input: {
  alertActionId: string;
  expectedVersion: number;
  opportunityId: string;
}): Promise<CommercialActionCommandResult> {
  return sendAction({
    command: 'associate_response',
    action_id: input.alertActionId,
    expected_version: input.expectedVersion,
    opportunity_id: input.opportunityId,
  });
}

export async function unblockCommercialContact(input: {
  canonicalPhone: string;
  reason: string;
}): Promise<void> {
  const value = await sendActionBody({
    command: 'unblock_contact',
    canonical_phone: input.canonicalPhone,
    reason: input.reason,
  });
  const record = asObject(value);
  if (record.unblocked !== true || record.canonical_phone !== input.canonicalPhone) {
    invalidResponse();
  }
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

function parseManualContactResult(value: unknown): CommercialManualContactResult {
  const record = asObject(value);
  const base = parseCommandResult(record);
  if (record.counts_as_follow_up !== true && record.counts_as_follow_up !== false) {
    invalidResponse();
  }
  if (record.source !== 'operator_statement') invalidResponse();
  return {
    ...base,
    eventId: text(record.event_id, 255),
    commandId: text(record.command_id, 255),
    contactType: member(record.contact_type, MANUAL_CONTACT_TYPES),
    occurredAt: timestamp(record.occurred_at),
    note: optionalText(record.note, 4000),
    resultCode: member(record.result_code, MANUAL_CONTACT_RESULTS),
    countsAsFollowUp: record.counts_as_follow_up,
    continuationType: member(record.continuation_type, MANUAL_CONTACT_CONTINUATIONS),
    source: 'operator_statement',
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

async function sendAction(
  payload: Record<string, unknown>
): Promise<CommercialActionCommandResult> {
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
  input: { actionId: string; expectedVersion: number } & (
    | CommercialActionCompletion
    | { outcome: CommercialActionCompletion }
  )
): Promise<CommercialActionCommandResult> {
  const selected = 'outcome' in input ? input.outcome : input;
  const outcome =
    'successor' in selected
      ? { successor: schedulePayload(selected.successor) }
      : { close: { reason: selected.closeReason } };
  return sendAction({
    command: 'complete',
    action_id: input.actionId,
    expected_version: input.expectedVersion,
    ...outcome,
  });
}

function manualContactPayload(input: CommercialManualContactInput): Record<string, unknown> {
  const continuation =
    input.continuation.type === 'close'
      ? { type: 'close', reason: input.continuation.closeReason }
      : {
          type: input.continuation.type,
          schedule: schedulePayload(input.continuation.schedule),
        };
  return {
    command: 'manual_contact',
    command_id: input.commandId,
    opportunity_id: input.opportunityId,
    action_id: input.actionId,
    expected_version: input.expectedVersion,
    contact_type: input.contactType,
    occurred_at: input.occurredAt,
    note: input.note,
    result_code: input.resultCode,
    counts_as_follow_up: input.countsAsFollowUp,
    continuation,
  };
}

export function recordManualContact(
  input: CommercialManualContactInput
): Promise<CommercialManualContactResult> {
  return sendActionBody(manualContactPayload(input)).then(parseManualContactResult);
}

export function continueCommercialFollowUp(
  input: CommercialFollowUpContinuityInput
): Promise<CommercialActionCommandResult> {
  return sendAction({
    command: 'continue_follow_up',
    command_id: input.commandId,
    opportunity_id: input.opportunityId,
    action_id: input.actionId,
    expected_version: input.expectedVersion,
    continuity_type: input.type,
    ...schedulePayload(input.schedule),
  });
}

function parseHistoryEntry(value: unknown): CommercialActionHistoryEntry {
  const record = asObject(value);
  const type = member(record.type, [
    'created',
    'rescheduled',
    'completed',
    'replaced',
    'manual_contact',
  ] as const);
  const manual = type === 'manual_contact';
  const contactType =
    record.contact_type === undefined
      ? undefined
      : member(record.contact_type, MANUAL_CONTACT_TYPES);
  const resultCode =
    record.result_code === undefined
      ? undefined
      : member(record.result_code, MANUAL_CONTACT_RESULTS);
  const continuationType =
    record.continuation_type === undefined
      ? undefined
      : member(record.continuation_type, MANUAL_CONTACT_CONTINUATIONS);
  if (
    manual &&
    (record.source !== 'operator_statement' || !contactType || !resultCode || !continuationType)
  ) {
    invalidResponse();
  }
  return {
    eventId: text(record.event_id, 255),
    actionId: text(record.action_id, 255),
    type,
    actor: text(record.actor, 128),
    timestamp: timestamp(record.timestamp),
    origin: member(record.origin, ORIGINS),
    reason: text(record.reason, 500),
    state: member(record.state, STATES),
    replacementActionId:
      record.replacement_action_id === null || record.replacement_action_id === undefined
        ? null
        : text(record.replacement_action_id, 255),
    ...(manual
      ? {
          contactType,
          occurredAt: timestamp(record.occurred_at),
          note: optionalText(record.note, 4000),
          resultCode,
          resultLabel: text(record.result_label, 255),
          countsAsFollowUp:
            record.counts_as_follow_up === true || record.counts_as_follow_up === false
              ? record.counts_as_follow_up
              : invalidResponse(),
          source: 'operator_statement' as const,
          continuationType,
          successorActionId:
            record.successor_action_id === null || record.successor_action_id === undefined
              ? null
              : text(record.successor_action_id, 255),
          closeReason: optionalText(record.close_reason, 500),
        }
      : {}),
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
