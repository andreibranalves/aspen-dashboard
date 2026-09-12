import { and, asc, eq, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';

import { calendarDateInSaoPaulo } from '../../../_shared/calendar-sao-paulo.js';
import { getDatabase, type AppDatabase } from '../client.js';
import { crmDeals, manualContactEvents, opportunityNextActions } from '../schema.js';
import type { OpportunityProposal } from './proposal-opportunity-repository.js';

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
export type OpportunityQueueFilter = 'active' | 'overdue' | 'today' | 'scheduled' | 'closed';
export type OpportunityContactContextStatus = 'available' | 'unavailable' | 'review';
export type OpportunityContactDirection = 'inbound' | 'outbound' | null;
export type ManualContactType = 'phone_call' | 'external_conversation';
export type ManualContactResultCode =
  | 'follow_up_agreed'
  | 'interested'
  | 'not_interested'
  | 'no_response'
  | 'awaiting_information'
  | 'wrong_contact'
  | 'other';
export type ManualContactContinuationType = 'successor' | 'wait' | 'close';

export interface OpportunityQueueBlocker {
  code: string;
  label: string;
}

export interface OpportunityContactContext {
  status: OpportunityContactContextStatus;
  lastContactAt: string | null;
  lastContactDirection: OpportunityContactDirection;
  blockers: OpportunityQueueBlocker[];
}

const ACTION_KINDS: readonly OpportunityActionKind[] = [
  'first_contact',
  'internal',
  'customer_contact',
  'agreed_commitment',
  'review',
];
const ACTION_ORIGINS: readonly OpportunityActionOrigin[] = ['manual', 'automatic', 'event'];
const CLOSED_OPPORTUNITY_STATUSES = ['Pedido Fechado', 'Perdido'] as const;
const QUEUE_FILTERS: readonly OpportunityQueueFilter[] = [
  'active',
  'overdue',
  'today',
  'scheduled',
  'closed',
];
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^\d{2}:\d{2}$/;
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;
const MAX_REASON_LENGTH = 500;
const MAX_ACTOR_LENGTH = 128;
const MANUAL_CONTACT_TYPES: readonly ManualContactType[] = ['phone_call', 'external_conversation'];
const MANUAL_CONTACT_RESULTS: readonly ManualContactResultCode[] = [
  'follow_up_agreed',
  'interested',
  'not_interested',
  'no_response',
  'awaiting_information',
  'wrong_contact',
  'other',
];
const MANUAL_CONTINUATIONS: readonly ManualContactContinuationType[] = [
  'successor',
  'wait',
  'close',
];

/** One prioritized item of the commercial queue: a demand and its pending work. */
export interface OpportunityQueueItem {
  actionId: string;
  opportunityId: string;
  kind: OpportunityActionKind;
  reasonCode: string;
  reason: string;
  origin: OpportunityActionOrigin;
  state: OpportunityActionState;
  dueAt: string;
  dueDate: string;
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
  contactContext: OpportunityContactContext;
  whatsappHref: string | null;
  demandSummary: string | null;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  clientId: string | null;
  clientName: string | null;
  /** Every proposal linked to the demand, with value and state. */
  proposals: OpportunityProposal[];
}

export interface OpportunityQueuePage {
  data: OpportunityQueueItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OpportunityQueueListOptions {
  page?: number;
  pageSize?: number;
  filter?: OpportunityQueueFilter;
}

export interface OpportunityActionScheduleInput {
  kind: OpportunityActionKind;
  dueDate: string;
  dueTime?: string | null;
  reason: string;
  reasonCode?: string;
  origin?: OpportunityActionOrigin;
}

export interface CreateOpportunityActionInput extends OpportunityActionScheduleInput {
  opportunityId: string;
  actor: string;
  now?: Date;
  transitionOrigin?: OpportunityActionOrigin;
  /** When present, create is an atomic replacement of this active action. */
  replaceActionId?: string;
  expectedVersion?: number;
}

export interface RescheduleOpportunityActionInput extends OpportunityActionScheduleInput {
  actionId: string;
  actor: string;
  expectedVersion: number;
  now?: Date;
  transitionOrigin?: OpportunityActionOrigin;
}

export interface CompleteOpportunityActionInput {
  actionId: string;
  actor: string;
  expectedVersion: number;
  now?: Date;
  transitionOrigin?: OpportunityActionOrigin;
  successor?: OpportunityActionScheduleInput;
  close?: { reason: string };
}

export type ManualContactContinuation =
  | { type: 'successor'; schedule: OpportunityActionScheduleInput }
  | { type: 'wait'; schedule: OpportunityActionScheduleInput }
  | { type: 'close'; reason: string };

export interface ManualContactInput {
  commandId: string;
  opportunityId: string;
  actionId: string;
  expectedVersion: number;
  contactType: ManualContactType;
  occurredAt: Date | string;
  note?: string | null;
  resultCode: ManualContactResultCode;
  countsAsFollowUp: boolean;
  actor: string;
  continuation?: ManualContactContinuation;
  now?: Date;
}

export interface OpportunityActionRecord {
  actionId: string;
  opportunityId: string;
  kind: OpportunityActionKind;
  reasonCode: string;
  reason: string;
  origin: OpportunityActionOrigin;
  state: OpportunityActionState;
  dueAt: string;
  dueDate: string;
  dueTime: string | null;
  scheduleType: OpportunityActionScheduleType;
  version: number;
  actor: string;
  createdAt: string;
  updatedAt: string;
  transitionActor: string | null;
  transitionAt: string | null;
  transitionOrigin: OpportunityActionOrigin | null;
  transitionReason: string | null;
  replacedById: string | null;
}

export type OpportunityActionHistoryType =
  | 'created'
  | 'rescheduled'
  | 'completed'
  | 'replaced'
  | 'manual_contact';

export interface OpportunityActionHistoryEntry {
  eventId: string;
  actionId: string;
  type: OpportunityActionHistoryType;
  actor: string;
  timestamp: string;
  origin: OpportunityActionOrigin;
  reason: string;
  state: OpportunityActionState;
  replacementActionId: string | null;
  contactType?: ManualContactType;
  occurredAt?: string;
  note?: string | null;
  resultCode?: ManualContactResultCode;
  countsAsFollowUp?: boolean;
  source?: 'operator_statement';
  continuationType?: ManualContactContinuationType;
  successorActionId?: string | null;
  closeReason?: string | null;
}

export interface OpportunityActionCommandResult {
  actionId: string;
  opportunityId: string;
  state: OpportunityActionState;
  version: number;
  action: OpportunityActionRecord | null;
  successor: OpportunityActionRecord | null;
  closed: boolean;
}

export interface ManualContactCommandResult extends OpportunityActionCommandResult {
  eventId: string;
  commandId: string;
  contactType: ManualContactType;
  occurredAt: string;
  note: string | null;
  resultCode: ManualContactResultCode;
  countsAsFollowUp: boolean;
  continuationType: ManualContactContinuationType;
  source: 'operator_statement';
}

export interface SetOpportunityUrgencyInput {
  opportunityId: string;
  actionId: string;
  expectedVersion: number;
  isUrgent: boolean;
  actor: string;
  now?: Date;
}

export interface OpportunityUrgencyResult {
  opportunityId: string;
  actionId: string;
  version: number;
  isUrgent: boolean;
}

export interface OpportunityActionRepository {
  listActive(options?: OpportunityQueueListOptions): Promise<OpportunityQueuePage>;
  createAction(input: CreateOpportunityActionInput): Promise<OpportunityActionCommandResult>;
  rescheduleAction(
    input: RescheduleOpportunityActionInput
  ): Promise<OpportunityActionCommandResult>;
  completeAction(input: CompleteOpportunityActionInput): Promise<OpportunityActionCommandResult>;
  recordManualContact(input: ManualContactInput): Promise<ManualContactCommandResult>;
  listHistory(opportunityId: string): Promise<OpportunityActionHistoryEntry[]>;
  setUrgency(input: SetOpportunityUrgencyInput): Promise<OpportunityUrgencyResult>;
}

export class OpportunityActionInputError extends Error {
  readonly statusCode = 400;
  readonly logMessage: string;
  constructor(message = 'Dados inválidos da próxima ação.') {
    super(message);
    this.name = 'OpportunityActionInputError';
    this.logMessage = message;
  }
}

export class ActionNotFoundError extends Error {
  readonly statusCode = 404;
  readonly logMessage: string;
  constructor(message = 'A próxima ação não foi encontrada.') {
    super(message);
    this.name = 'ActionNotFoundError';
    this.logMessage = message;
  }
}

export class ActionConflictError extends Error {
  readonly statusCode = 409;
  readonly logMessage: string;
  constructor(message = 'A fila mudou. Recarregue e tente novamente.') {
    super(message);
    this.name = 'ActionConflictError';
    this.logMessage = message;
  }
}

export class OpportunityActionRepositoryError extends Error {
  readonly statusCode = 503;
  readonly logMessage = 'Não foi possível acessar a fila comercial.';
  constructor() {
    super('Não foi possível acessar a fila comercial.');
    this.name = 'OpportunityActionRepositoryError';
  }
}

type DatabaseProvider = () => AppDatabase;
type OpportunityActionTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
type ActionDatabase = AppDatabase | OpportunityActionTransaction;
/** Open transaction that shares the same Drizzle query surface as the pool. */
export type OpportunityActionDatabase = Pick<AppDatabase, 'select' | 'insert'>;

export interface OpportunityActionRepositoryOptions {
  now?: () => Date;
  idFactory?: () => string;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new OpportunityActionInputError('Paginação inválida da fila comercial.');
  }
  return Math.min(Math.floor(parsed), maximum);
}

function safeDate(value: unknown, fallback = new Date(0)): Date {
  const candidate = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  return Number.isNaN(candidate.getTime()) ? new Date(fallback.getTime()) : candidate;
}

function isoDate(value: unknown, fallback = new Date(0)): string {
  return safeDate(value, fallback).toISOString();
}

function nowDate(value: Date | undefined, factory: () => Date): Date {
  return safeDate(value || factory(), new Date());
}

function cleanText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new OpportunityActionInputError(
      `${label} é obrigatório e deve ter no máximo ${maximum} caracteres.`
    );
  }
  return value.trim();
}

function validateVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new OpportunityActionInputError('Token de versão inválido. Recarregue a fila.');
  }
  return Number(value);
}

function validateDate(value: unknown): string {
  if (typeof value !== 'string' || !LOCAL_DATE.test(value)) {
    throw new OpportunityActionInputError('A data local da ação é obrigatória.');
  }
  const [year, month, day] = value.split('-').map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(candidate.getTime()) || candidate.toISOString().slice(0, 10) !== value) {
    throw new OpportunityActionInputError('A data local da ação é inválida.');
  }
  return value;
}

function validateTime(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !LOCAL_TIME.test(value)) {
    throw new OpportunityActionInputError('O horário local da ação é inválido.');
  }
  const [hour, minute] = value.split(':').map(Number);
  if (hour > 23 || minute > 59) {
    throw new OpportunityActionInputError('O horário local da ação é inválido.');
  }
  return value;
}

function validateKind(value: unknown): OpportunityActionKind {
  if (typeof value !== 'string' || !ACTION_KINDS.includes(value as OpportunityActionKind)) {
    throw new OpportunityActionInputError('Tipo de ação inválido.');
  }
  return value as OpportunityActionKind;
}

function validateOrigin(value: unknown): OpportunityActionOrigin {
  const origin = value === undefined ? 'manual' : value;
  if (typeof origin !== 'string' || !ACTION_ORIGINS.includes(origin as OpportunityActionOrigin)) {
    throw new OpportunityActionInputError('Origem da ação inválida.');
  }
  return origin as OpportunityActionOrigin;
}

function validateTransitionOrigin(value: unknown): OpportunityActionOrigin {
  return validateOrigin(value);
}

function defaultReasonCode(kind: OpportunityActionKind): string {
  return kind === 'first_contact' ? 'new_lead' : 'manual_action';
}

interface NormalizedSchedule {
  kind: OpportunityActionKind;
  dueDate: string;
  dueTime: string | null;
  scheduleType: OpportunityActionScheduleType;
  dueAt: Date;
  reason: string;
  reasonCode: string;
  origin: OpportunityActionOrigin;
}

function normalizeSchedule(input: OpportunityActionScheduleInput): NormalizedSchedule {
  const dueDate = validateDate(input.dueDate);
  const dueTime = validateTime(input.dueTime);
  const kind = validateKind(input.kind);
  const reason = cleanText(input.reason, 'O motivo', MAX_REASON_LENGTH);
  const reasonCode = cleanText(
    input.reasonCode || defaultReasonCode(kind),
    'O código do motivo',
    32
  );
  const origin = validateOrigin(input.origin);
  // São Paulo has used UTC-03:00 since the operational calendar stopped
  // observing daylight saving time. The civil fields remain the source of
  // truth; due_at only supports ordering and timed comparisons.
  const dueAt = new Date(`${dueDate}T${dueTime || '00:00'}:00-03:00`);
  if (Number.isNaN(dueAt.getTime())) {
    throw new OpportunityActionInputError('A agenda local da ação é inválida.');
  }
  return {
    kind,
    dueDate,
    dueTime,
    scheduleType: dueTime ? 'timed' : 'date_only',
    dueAt,
    reason,
    reasonCode,
    origin,
  };
}

interface NormalizedManualContact {
  commandId: string;
  opportunityId: string;
  actionId: string;
  expectedVersion: number;
  contactType: ManualContactType;
  occurredAt: Date;
  note: string | null;
  resultCode: ManualContactResultCode;
  countsAsFollowUp: boolean;
  actor: string;
  continuation: {
    type: ManualContactContinuationType;
    schedule: NormalizedSchedule | null;
    closeReason: string | null;
  };
}

function validateManualContactType(value: unknown): ManualContactType {
  if (!MANUAL_CONTACT_TYPES.includes(value as ManualContactType)) {
    throw new OpportunityActionInputError('Tipo de contato manual inválido.');
  }
  return value as ManualContactType;
}

function validateManualContactResult(value: unknown): ManualContactResultCode {
  if (!MANUAL_CONTACT_RESULTS.includes(value as ManualContactResultCode)) {
    throw new OpportunityActionInputError('Resultado do contato manual inválido.');
  }
  return value as ManualContactResultCode;
}

export function isStrictIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_TIMESTAMP.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
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
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }
  if (match[7] !== 'Z' && (Number(match[9]) > 23 || Number(match[10]) > 59)) {
    return false;
  }
  return !Number.isNaN(new Date(value).getTime());
}

function validateOccurredAt(value: unknown): Date {
  if (typeof value === 'string') {
    if (!isStrictIsoTimestamp(value)) {
      throw new OpportunityActionInputError('A data e hora do contato são inválidas.');
    }
    const candidate = new Date(value);
    if (!Number.isNaN(candidate.getTime())) return candidate;
  } else if (value instanceof Date) {
    const candidate = new Date(value.getTime());
    if (!Number.isNaN(candidate.getTime())) return candidate;
  }
  throw new OpportunityActionInputError('A data e hora do contato são inválidas.');
}

function optionalNote(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > 4000) {
    throw new OpportunityActionInputError('A observação deve ter no máximo 4000 caracteres.');
  }
  return value.trim() || null;
}

function validateManualContinuation(
  value: ManualContactContinuation | undefined
): NormalizedManualContact['continuation'] {
  if (!value || !MANUAL_CONTINUATIONS.includes(value.type)) {
    throw new OpportunityActionInputError(
      'O contato manual exige uma continuidade: próxima ação, espera ou fechamento.'
    );
  }
  if (value.type === 'close') {
    return {
      type: 'close',
      schedule: null,
      closeReason: cleanText(value.reason, 'O motivo do fechamento', 500),
    };
  }
  const schedule = normalizeSchedule({ ...value.schedule, origin: 'manual' });
  return { type: value.type, schedule, closeReason: null };
}

function normalizeManualContact(input: ManualContactInput): NormalizedManualContact {
  const continuation = validateManualContinuation(input.continuation);
  if (typeof input.countsAsFollowUp !== 'boolean') {
    throw new OpportunityActionInputError('A marcação de follow-up concluído é obrigatória.');
  }
  return {
    commandId: cleanText(input.commandId, 'O ID do comando', 255),
    opportunityId: cleanText(input.opportunityId, 'O ID da oportunidade', 255),
    actionId: cleanText(input.actionId, 'O ID da ação', 255),
    expectedVersion: validateVersion(input.expectedVersion),
    contactType: validateManualContactType(input.contactType),
    occurredAt: validateOccurredAt(input.occurredAt),
    note: optionalNote(input.note),
    resultCode: validateManualContactResult(input.resultCode),
    countsAsFollowUp: input.countsAsFollowUp,
    actor: cleanText(input.actor, 'O ator', MAX_ACTOR_LENGTH),
    continuation,
  };
}

function manualContactFingerprint(input: NormalizedManualContact): string {
  const semantic = {
    opportunityId: input.opportunityId,
    actionId: input.actionId,
    expectedVersion: input.expectedVersion,
    contactType: input.contactType,
    occurredAt: input.occurredAt.toISOString(),
    note: input.note,
    resultCode: input.resultCode,
    countsAsFollowUp: input.countsAsFollowUp,
    continuation: input.continuation.schedule
      ? {
          type: input.continuation.type,
          kind: input.continuation.schedule.kind,
          dueDate: input.continuation.schedule.dueDate,
          dueTime: input.continuation.schedule.dueTime,
          reasonCode: input.continuation.schedule.reasonCode,
          reason: input.continuation.schedule.reason,
        }
      : { type: 'close', closeReason: input.continuation.closeReason },
  };
  return createHash('sha256').update(JSON.stringify(semantic)).digest('hex');
}

function localPartsFromInstant(value: Date): { dueDate: string; dueTime: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return {
    dueDate: `${get('year')}-${get('month')}-${get('day')}`,
    dueTime: `${get('hour')}:${get('minute')}`,
  };
}

function rowDate(value: unknown, fallback: Date): string {
  const candidate = String(value || '');
  return LOCAL_DATE.test(candidate) ? candidate : calendarDateInSaoPaulo(fallback);
}

function rowTime(value: unknown): string | null {
  const candidate = String(value || '');
  return /^\d{2}:\d{2}/.test(candidate) ? candidate.slice(0, 5) : null;
}

function rowKind(value: unknown): OpportunityActionKind {
  return ACTION_KINDS.includes(value as OpportunityActionKind)
    ? (value as OpportunityActionKind)
    : 'first_contact';
}

function rowOrigin(value: unknown): OpportunityActionOrigin {
  return ACTION_ORIGINS.includes(value as OpportunityActionOrigin)
    ? (value as OpportunityActionOrigin)
    : 'automatic';
}

function rowOriginNullable(value: unknown): OpportunityActionOrigin | null {
  if (value === null || value === undefined) return null;
  return ACTION_ORIGINS.includes(value as OpportunityActionOrigin)
    ? (value as OpportunityActionOrigin)
    : null;
}

function rowState(value: unknown): OpportunityActionState {
  if (value === 'completed' || value === 'cancelled' || value === 'superseded') return value;
  return 'active';
}

function rowScheduleType(value: unknown): OpportunityActionScheduleType {
  return value === 'date_only' ? 'date_only' : 'timed';
}

function rowRecord(row: typeof opportunityNextActions.$inferSelect): OpportunityActionRecord {
  const dueAt = safeDate(row.dueAt);
  return {
    actionId: row.id,
    opportunityId: row.opportunityId,
    kind: rowKind(row.kind),
    reasonCode: row.reasonCode,
    reason: row.reason,
    origin: rowOrigin(row.origin),
    state: rowState(row.state),
    dueAt: dueAt.toISOString(),
    dueDate: rowDate(row.dueDate, dueAt),
    dueTime: rowScheduleType(row.scheduleType) === 'date_only' ? null : rowTime(row.dueTime),
    scheduleType: rowScheduleType(row.scheduleType),
    version: row.version,
    actor: row.actor,
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
    transitionActor: row.transitionActor,
    transitionAt: row.transitionAt ? isoDate(row.transitionAt) : null,
    transitionOrigin: rowOriginNullable(row.transitionOrigin),
    transitionReason: row.transitionReason,
    replacedById: row.replacedById,
  };
}

function dueStatus(
  scheduleType: OpportunityActionScheduleType,
  dueDate: string,
  dueAt: Date,
  now: Date
): OpportunityActionDueStatus {
  if (scheduleType === 'date_only') {
    const today = calendarDateInSaoPaulo(now);
    if (dueDate < today) return 'overdue';
    if (dueDate === today) return 'today';
    return 'upcoming';
  }
  if (dueAt.getTime() <= now.getTime()) return 'overdue';
  if (dueDate === calendarDateInSaoPaulo(now)) return 'today';
  return 'upcoming';
}

interface QueueRow {
  total: number;
  page: number;
  action_id: string;
  opportunity_id: string;
  kind: string;
  reason_code: string;
  reason: string;
  origin: string;
  state: string;
  due_at: Date | string;
  due_date: string | null;
  due_time: string | null;
  schedule_type: string;
  version: number;
  actor: string;
  is_urgent: boolean;
  priority: number;
  follow_up_stage: number;
  opportunity_status: string;
  terminal_status: string | null;
  terminal_reason: string | null;
  terminal_at: Date | string | null;
  contact_context_status: OpportunityContactContextStatus;
  last_contact_at: Date | string | null;
  last_contact_direction: OpportunityContactDirection;
  blockers: unknown;
  whatsapp_href: string | null;
  demand_summary: string | null;
  contact_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  client_id: string | null;
  client_name: string | null;
  proposals: unknown;
}

interface ProposalJsonRow {
  quotation_id?: unknown;
  business_number?: unknown;
  status?: unknown;
  total?: unknown;
  created_at?: unknown;
}

interface BlockerJsonRow {
  code?: unknown;
  label?: unknown;
}

function parseProposals(value: unknown): OpportunityProposal[] {
  if (!Array.isArray(value)) return [];
  const proposals: OpportunityProposal[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as ProposalJsonRow;
    if (typeof row.quotation_id !== 'string' || typeof row.business_number !== 'string') continue;
    const createdAt =
      row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at));
    proposals.push({
      quotationId: row.quotation_id,
      businessNumber: row.business_number,
      status: typeof row.status === 'string' ? row.status : 'rascunho',
      total: row.total === null || row.total === undefined ? null : String(row.total),
      createdAt: Number.isNaN(createdAt.getTime())
        ? new Date(0).toISOString()
        : createdAt.toISOString(),
    });
  }
  return proposals;
}

function parseBlockers(value: unknown): OpportunityQueueBlocker[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as BlockerJsonRow;
    return typeof row.code === 'string' && typeof row.label === 'string'
      ? [{ code: row.code, label: row.label }]
      : [];
  });
}

function rowContactContext(row: QueueRow): OpportunityContactContext {
  const status: OpportunityContactContextStatus =
    row.contact_context_status === 'available' || row.contact_context_status === 'review'
      ? row.contact_context_status
      : 'unavailable';
  return {
    status,
    lastContactAt: row.last_contact_at ? isoDate(row.last_contact_at) : null,
    lastContactDirection:
      row.last_contact_direction === 'inbound' || row.last_contact_direction === 'outbound'
        ? row.last_contact_direction
        : null,
    blockers: parseBlockers(row.blockers),
  };
}

function preserveKnownError(error: unknown): never {
  if (
    error instanceof OpportunityActionInputError ||
    error instanceof ActionConflictError ||
    error instanceof ActionNotFoundError
  ) {
    throw error;
  }
  throw new OpportunityActionRepositoryError();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function assertOpenOpportunity(status: string): void {
  if (
    CLOSED_OPPORTUNITY_STATUSES.includes(status as (typeof CLOSED_OPPORTUNITY_STATUSES)[number])
  ) {
    throw new ActionConflictError('A oportunidade já está encerrada. Recarregue a fila.');
  }
}

function assertExpectedAction(
  action: typeof opportunityNextActions.$inferSelect,
  expectedVersion: number
): void {
  if (action.state !== 'active' || action.version !== expectedVersion) {
    throw new ActionConflictError();
  }
}

async function lockOpportunity(
  database: ActionDatabase,
  opportunityId: string
): Promise<typeof crmDeals.$inferSelect> {
  const [deal] = await database
    .select()
    .from(crmDeals)
    .where(eq(crmDeals.id, opportunityId))
    .for('update')
    .limit(1);
  if (!deal) throw new ActionNotFoundError('Oportunidade não encontrada.');
  return deal;
}

async function lockAction(
  database: ActionDatabase,
  actionId: string,
  opportunityId: string
): Promise<typeof opportunityNextActions.$inferSelect> {
  const [action] = await database
    .select()
    .from(opportunityNextActions)
    .where(
      and(
        eq(opportunityNextActions.id, actionId),
        eq(opportunityNextActions.opportunityId, opportunityId)
      )
    )
    .for('update')
    .limit(1);
  if (!action) throw new ActionNotFoundError();
  return action;
}

async function activeAction(
  database: ActionDatabase,
  opportunityId: string
): Promise<typeof opportunityNextActions.$inferSelect | null> {
  const [action] = await database
    .select()
    .from(opportunityNextActions)
    .where(
      and(
        eq(opportunityNextActions.opportunityId, opportunityId),
        eq(opportunityNextActions.state, 'active')
      )
    )
    .for('update')
    .limit(1);
  return action || null;
}

async function insertAction(
  database: ActionDatabase,
  opportunityId: string,
  actionId: string,
  schedule: NormalizedSchedule,
  actor: string,
  now: Date,
  version: number
): Promise<OpportunityActionRecord> {
  const [created] = await database
    .insert(opportunityNextActions)
    .values({
      id: actionId,
      opportunityId,
      kind: schedule.kind,
      reasonCode: schedule.reasonCode,
      reason: schedule.reason,
      origin: schedule.origin,
      state: 'active',
      dueAt: schedule.dueAt,
      dueDate: schedule.dueDate,
      dueTime: schedule.dueTime,
      scheduleType: schedule.scheduleType,
      version,
      actor,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!created) throw new OpportunityActionRepositoryError();
  return rowRecord(created);
}

async function replaceActiveAction(
  database: ActionDatabase,
  oldAction: typeof opportunityNextActions.$inferSelect,
  schedule: NormalizedSchedule,
  actor: string,
  transitionOrigin: OpportunityActionOrigin,
  reason: string,
  now: Date,
  idFactory: () => string
): Promise<OpportunityActionCommandResult> {
  const successorId = idFactory();
  const changed = await database
    .update(opportunityNextActions)
    .set({
      state: 'superseded',
      updatedAt: now,
      transitionActor: actor,
      transitionAt: now,
      transitionOrigin,
      transitionReason: reason,
      replacedById: successorId,
    })
    .where(
      and(
        eq(opportunityNextActions.id, oldAction.id),
        eq(opportunityNextActions.state, 'active'),
        eq(opportunityNextActions.version, oldAction.version)
      )
    )
    .returning();
  if (changed.length !== 1) throw new ActionConflictError();
  const successor = await insertAction(
    database,
    oldAction.opportunityId,
    successorId,
    schedule,
    actor,
    now,
    oldAction.version + 1
  );
  return {
    actionId: oldAction.id,
    opportunityId: oldAction.opportunityId,
    state: 'superseded',
    version: successor.version,
    action: rowRecord(changed[0]),
    successor,
    closed: false,
  };
}

async function completeWithSuccessor(
  database: ActionDatabase,
  oldAction: typeof opportunityNextActions.$inferSelect,
  schedule: NormalizedSchedule,
  actor: string,
  transitionOrigin: OpportunityActionOrigin,
  reason: string,
  now: Date,
  idFactory: () => string
): Promise<OpportunityActionCommandResult> {
  const successorId = idFactory();
  const changed = await database
    .update(opportunityNextActions)
    .set({
      state: 'completed',
      updatedAt: now,
      transitionActor: actor,
      transitionAt: now,
      transitionOrigin,
      transitionReason: reason,
      replacedById: successorId,
    })
    .where(
      and(
        eq(opportunityNextActions.id, oldAction.id),
        eq(opportunityNextActions.state, 'active'),
        eq(opportunityNextActions.version, oldAction.version)
      )
    )
    .returning();
  if (changed.length !== 1) throw new ActionConflictError();
  const successor = await insertAction(
    database,
    oldAction.opportunityId,
    successorId,
    schedule,
    actor,
    now,
    oldAction.version + 1
  );
  return {
    actionId: oldAction.id,
    opportunityId: oldAction.opportunityId,
    state: 'completed',
    version: successor.version,
    action: rowRecord(changed[0]),
    successor,
    closed: false,
  };
}

async function completeWithClose(
  database: ActionDatabase,
  deal: typeof crmDeals.$inferSelect,
  oldAction: typeof opportunityNextActions.$inferSelect,
  actor: string,
  reason: string,
  now: Date
): Promise<OpportunityActionCommandResult> {
  const changed = await database
    .update(opportunityNextActions)
    .set({
      state: 'completed',
      updatedAt: now,
      transitionActor: actor,
      transitionAt: now,
      transitionOrigin: 'manual',
      transitionReason: reason,
      replacedById: null,
    })
    .where(
      and(
        eq(opportunityNextActions.id, oldAction.id),
        eq(opportunityNextActions.state, 'active'),
        eq(opportunityNextActions.version, oldAction.version)
      )
    )
    .returning();
  if (changed.length !== 1) throw new ActionConflictError();
  const [closed] = await database
    .update(crmDeals)
    .set({ status: 'Perdido', lostReason: reason, updatedAt: now })
    .where(eq(crmDeals.id, deal.id))
    .returning({ id: crmDeals.id });
  if (!closed) throw new ActionConflictError();
  return {
    actionId: oldAction.id,
    opportunityId: oldAction.opportunityId,
    state: 'completed',
    version: oldAction.version + 1,
    action: rowRecord(changed[0]),
    successor: null,
    closed: true,
  };
}

async function findManualContactEvent(
  database: ActionDatabase,
  commandId: string
): Promise<typeof manualContactEvents.$inferSelect | null> {
  const [event] = await database
    .select()
    .from(manualContactEvents)
    .where(eq(manualContactEvents.commandId, commandId))
    .limit(1);
  return event || null;
}

function manualContactResultFromEvent(
  event: typeof manualContactEvents.$inferSelect,
  action: typeof opportunityNextActions.$inferSelect | null,
  successor: OpportunityActionRecord | null
): ManualContactCommandResult {
  return {
    actionId: event.actionId,
    opportunityId: event.opportunityId,
    state: 'completed',
    version: event.resultVersion,
    action: action ? rowRecord(action) : null,
    successor,
    closed: event.closed,
    eventId: event.id,
    commandId: event.commandId,
    contactType: event.contactType as ManualContactType,
    occurredAt: isoDate(event.occurredAt),
    note: event.note,
    resultCode: event.resultCode as ManualContactResultCode,
    countsAsFollowUp: event.countsAsFollowUp,
    continuationType: event.continuationType as ManualContactContinuationType,
    source: 'operator_statement',
  };
}

async function replayManualContact(
  database: ActionDatabase,
  event: typeof manualContactEvents.$inferSelect,
  fingerprint: string
): Promise<ManualContactCommandResult> {
  if (event.commandFingerprint !== fingerprint) {
    throw new ActionConflictError('O ID do comando já foi usado com outro contato manual.');
  }
  const [action] = await database
    .select()
    .from(opportunityNextActions)
    .where(eq(opportunityNextActions.id, event.actionId))
    .limit(1);
  let successor: OpportunityActionRecord | null = null;
  if (event.successorActionId) {
    const [row] = await database
      .select()
      .from(opportunityNextActions)
      .where(eq(opportunityNextActions.id, event.successorActionId))
      .limit(1);
    if (row) {
      // The successor's schedule and creation metadata are immutable. Its
      // state/version/transition fields are the mutable part of the live row,
      // so rebuild the exact initial snapshot returned by the command.
      successor = rowRecord({
        ...row,
        state: 'active',
        version: event.resultVersion,
        updatedAt: row.createdAt,
        transitionActor: null,
        transitionAt: null,
        transitionOrigin: null,
        transitionReason: null,
        replacedById: null,
      });
    }
  }
  return manualContactResultFromEvent(event, action || null, successor);
}

/**
 * Guarantees the first-contact action of an opportunity exists exactly once.
 * The first action ever created for a demand is the admission work; later
 * actions belong to the follow-up cycle (#242) and are not seeded here.
 */
export async function ensureFirstContactAction(
  database: OpportunityActionDatabase,
  input: { opportunityId: string; dueAt: Date; idFactory: () => string }
): Promise<void> {
  const [existing] = await database
    .select({ id: opportunityNextActions.id })
    .from(opportunityNextActions)
    .where(eq(opportunityNextActions.opportunityId, input.opportunityId))
    .limit(1);
  if (existing) return;

  const parts = localPartsFromInstant(input.dueAt);
  await database
    .insert(opportunityNextActions)
    .values({
      id: input.idFactory(),
      opportunityId: input.opportunityId,
      kind: 'first_contact',
      reasonCode: 'new_lead',
      reason: 'Primeiro atendimento',
      origin: 'automatic',
      state: 'active',
      dueAt: input.dueAt,
      dueDate: parts.dueDate,
      dueTime: parts.dueTime,
      scheduleType: 'timed',
      actor: 'system',
      version: 1,
      createdAt: input.dueAt,
      updatedAt: input.dueAt,
    })
    .onConflictDoNothing();
}

/** Read model and transactional command seam for opportunity next actions. */
export function createPostgresOpportunityActionRepository(
  getDb: DatabaseProvider = getDatabase,
  options: OpportunityActionRepositoryOptions = {}
): OpportunityActionRepository {
  const nowFactory = options.now || (() => new Date());
  const idFactory = options.idFactory || randomUUID;

  return {
    async listActive(listOptions: OpportunityQueueListOptions = {}): Promise<OpportunityQueuePage> {
      const page = positiveInteger(listOptions.page, 1, Number.MAX_SAFE_INTEGER);
      const pageSize = positiveInteger(listOptions.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
      const filter = listOptions.filter || 'active';
      if (!QUEUE_FILTERS.includes(filter)) {
        throw new OpportunityActionInputError('Filtro da fila comercial inválido.');
      }
      const closedStatuses = [...CLOSED_OPPORTUNITY_STATUSES];
      const now = nowDate(undefined, nowFactory);
      const nowIso = now.toISOString();

      try {
        const database = getDb();
        // One statement returns the consistent snapshot (total + clamped page)
        // and the page rows together. When a close or removal shrinks the queue
        // below the requested page, `page` is clamped to the last valid one.
        const rows = (await database.execute(sql`
          WITH candidate_actions AS (
            SELECT
              a.id AS action_id,
              a.opportunity_id,
              a.kind,
              a.reason_code,
              a.reason,
              a.origin,
              a.state,
              a.due_at,
              a.due_date,
              a.due_time,
              a.schedule_type,
              a.version,
              a.actor,
              a.created_at,
              a.updated_at,
              d.quote_lead_id,
              d.is_urgent,
              d.follow_up_stage,
              d.status AS opportunity_status,
              CASE WHEN d.status IN (${sql.join(
                closedStatuses.map((status) => sql`${status}`),
                sql`, `
              )}) THEN d.status ELSE NULL END AS terminal_status,
              CASE WHEN d.status IN (${sql.join(
                closedStatuses.map((status) => sql`${status}`),
                sql`, `
              )}) THEN d.lost_reason ELSE NULL END AS terminal_reason,
              CASE WHEN d.status IN (${sql.join(
                closedStatuses.map((status) => sql`${status}`),
                sql`, `
              )}) THEN d.updated_at ELSE NULL END AS terminal_at,
              d.demand_summary,
              d.nome AS contact_name,
              d.telefone AS contact_phone,
              d.email AS contact_email,
              d.client_id,
              c.nome AS client_name,
              CASE
                WHEN a.schedule_type = 'date_only' THEN
                  CASE
                    WHEN a.due_date < (${nowIso}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date THEN 'overdue'
                    WHEN a.due_date = (${nowIso}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date THEN 'today'
                    ELSE 'upcoming'
                  END
                WHEN a.due_at <= ${nowIso}::timestamptz THEN 'overdue'
                WHEN a.due_date = (${nowIso}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date THEN 'today'
                ELSE 'upcoming'
              END AS due_status_key,
              (
                SELECT coalesce(
                  json_agg(
                    json_build_object(
                      'quotation_id', q.id,
                      'business_number', q.business_number,
                      'status', q.status,
                      'total', r.total,
                      'created_at', q.created_at
                    ) ORDER BY q.created_at, q.id
                  ),
                  '[]'::json
                )
                FROM quotations q
                LEFT JOIN LATERAL (
                  SELECT rv.total
                  FROM quote_revisions rv
                  WHERE rv.quotation_id = q.id
                  ORDER BY rv.version DESC, rv.id ASC
                  LIMIT 1
                ) r ON true
                WHERE q.opportunity_id = d.id
              ) AS proposals
            FROM opportunity_next_actions a
            INNER JOIN crm_deals d ON d.id = a.opportunity_id
            LEFT JOIN clients c ON c.id = d.client_id
            WHERE (
              ${
                filter === 'closed'
                  ? sql`d.status IN (${sql.join(
                      closedStatuses.map((status) => sql`${status}`),
                      sql`, `
                    )})`
                  : sql`a.state = 'active' AND d.status NOT IN (${sql.join(
                      closedStatuses.map((status) => sql`${status}`),
                      sql`, `
                    )})`
              }
            )
          ),
          selected_actions AS (
            SELECT *
            FROM (
              SELECT
                candidate_actions.*,
                row_number() OVER (
                  PARTITION BY opportunity_id
                  ORDER BY updated_at DESC, created_at DESC, action_id DESC
                ) AS opportunity_row
              FROM candidate_actions
            ) candidates
            WHERE ${filter === 'closed' ? sql`opportunity_row = 1` : sql`true`}
          ),
          activity_matches AS (
            SELECT DISTINCT
              selected.action_id,
              activity.id AS activity_id,
              activity.last_inbound_at,
              activity.last_outbound_at,
              activity.identity_status,
              activity.blocked_at,
              activity.block_reason
            FROM selected_actions selected
            INNER JOIN whatsapp_contact_activity activity ON (
              EXISTS (
                SELECT 1
                FROM quote_leads lead
                WHERE lead.id = selected.quote_lead_id
                  AND lead.source = 'whatsapp'
                  AND lead.external_id = activity.provider_conversation_id
              )
              OR EXISTS (
                SELECT 1
                FROM quotation_follow_ups follow_up
                INNER JOIN quotations quotation ON quotation.id = follow_up.quotation_id
                WHERE quotation.opportunity_id = selected.opportunity_id
                  AND follow_up.instance = activity.instance
                  AND follow_up.provider_conversation_id = activity.provider_conversation_id
              )
            )
          ),
          contact_context AS (
            SELECT
              action_id,
              count(*)::int AS activity_count,
              CASE
                WHEN count(*) = 1 AND max(identity_status) IN ('verified', 'derived')
                  AND (max(last_inbound_at) IS NOT NULL OR max(last_outbound_at) IS NOT NULL)
                  THEN GREATEST(max(last_inbound_at), max(last_outbound_at))
                ELSE NULL
              END AS last_contact_at,
              CASE
                WHEN count(*) = 1 AND max(identity_status) IN ('verified', 'derived')
                  AND max(last_inbound_at) IS NOT NULL
                  AND (max(last_outbound_at) IS NULL OR max(last_inbound_at) > max(last_outbound_at))
                  THEN 'inbound'
                WHEN count(*) = 1 AND max(identity_status) IN ('verified', 'derived')
                  AND max(last_outbound_at) IS NOT NULL
                  AND (max(last_inbound_at) IS NULL OR max(last_outbound_at) >= max(last_inbound_at))
                  THEN 'outbound'
                ELSE NULL
              END AS last_contact_direction,
              CASE
                WHEN bool_or(blocked_at IS NOT NULL) THEN
                  json_build_array(json_build_object('code', 'do_not_contact', 'label', 'Não contatar'))
                ELSE '[]'::json
              END AS blockers,
              CASE
                WHEN count(*) = 1 AND max(identity_status) IN ('verified', 'derived') THEN true
                ELSE false
              END AS authoritative_identity
            FROM activity_matches
            GROUP BY action_id
          ),
          classified AS (
            SELECT
              selected.*,
              COALESCE(context.activity_count, 0) AS activity_count,
              CASE WHEN COALESCE(context.activity_count, 0) = 0 THEN 'unavailable'
                WHEN context.authoritative_identity THEN 'available'
                ELSE 'review'
              END AS contact_context_status,
              context.last_contact_at,
              context.last_contact_direction,
              COALESCE(context.blockers, '[]'::json) AS blockers,
              CASE
                WHEN selected.contact_phone ~ '^[0-9]{10,15}$'
                  THEN 'https://wa.me/' || selected.contact_phone
                ELSE NULL
              END AS whatsapp_href,
              CASE
                WHEN selected.is_urgent THEN 1
                WHEN selected.due_status_key = 'overdue' AND selected.kind = 'agreed_commitment' THEN 2
                WHEN context.authoritative_identity
                  AND context.last_contact_direction = 'inbound'
                  THEN 3
                WHEN selected.kind = 'first_contact' THEN 4
                WHEN selected.due_status_key = 'overdue' THEN 5
                WHEN selected.due_status_key = 'today' THEN 6
                WHEN selected.due_status_key = 'upcoming' THEN 7
                ELSE 8
              END AS priority
            FROM selected_actions selected
            LEFT JOIN contact_context context ON context.action_id = selected.action_id
          ),
          filtered AS (
            SELECT *
            FROM classified
            WHERE ${
              filter === 'overdue'
                ? sql`due_status_key = 'overdue'`
                : filter === 'today'
                  ? sql`due_status_key = 'today'`
                  : filter === 'scheduled'
                    ? sql`due_status_key = 'upcoming'`
                    : sql`true`
            }
          ),
          bounds AS (SELECT count(*)::int AS total FROM filtered),
          position AS (
            SELECT
              total,
              GREATEST(1, LEAST(${page}::int, CEIL(total::numeric / ${pageSize}::int)::int)) AS page
            FROM bounds
          )
          SELECT position.total, position.page, page_rows.*
          FROM position
          LEFT JOIN LATERAL (
            SELECT * FROM filtered
            ORDER BY
              CASE WHEN ${filter === 'closed' ? sql`true` : sql`false`} THEN updated_at END DESC NULLS LAST,
              priority ASC,
              due_at ASC,
              created_at ASC,
              action_id ASC
            LIMIT ${pageSize} OFFSET (position.page - 1) * ${pageSize}
          ) AS page_rows ON true
          ORDER BY
            CASE WHEN ${filter === 'closed' ? sql`true` : sql`false`} THEN page_rows.updated_at END DESC NULLS LAST,
            page_rows.priority ASC,
            page_rows.due_at ASC,
            page_rows.created_at ASC,
            page_rows.action_id ASC
        `)) as unknown as QueueRow[];

        const [first] = rows;
        if (!first) return { data: [], total: 0, page: 1, pageSize };
        return {
          data: rows
            .filter((row) => row.action_id)
            .map((row) => {
              const dueAt = safeDate(row.due_at);
              const scheduleType = rowScheduleType(row.schedule_type);
              const dueDate = rowDate(row.due_date, dueAt);
              return {
                actionId: row.action_id,
                opportunityId: row.opportunity_id,
                kind: rowKind(row.kind),
                reasonCode: row.reason_code,
                reason: row.reason,
                origin: rowOrigin(row.origin),
                state: rowState(row.state),
                dueAt: dueAt.toISOString(),
                dueDate,
                dueTime: scheduleType === 'date_only' ? null : rowTime(row.due_time),
                scheduleType,
                dueStatus:
                  filter === 'closed' ? 'closed' : dueStatus(scheduleType, dueDate, dueAt, now),
                version: Number(row.version || 1),
                actor: row.actor,
                isUrgent: row.is_urgent === true,
                priority: Number(row.priority || 8),
                followUpStage: Number(row.follow_up_stage || 0),
                opportunityStatus: row.opportunity_status,
                terminalStatus: row.terminal_status || null,
                terminalReason: row.terminal_reason || null,
                terminalAt: row.terminal_at ? isoDate(row.terminal_at) : null,
                contactContext: rowContactContext(row),
                whatsappHref: row.whatsapp_href,
                demandSummary: row.demand_summary,
                contactName: row.contact_name,
                contactPhone: row.contact_phone,
                contactEmail: row.contact_email,
                clientId: row.client_id,
                clientName: row.client_name,
                proposals: parseProposals(row.proposals),
              };
            }),
          total: Number(first.total ?? 0),
          page: Number(first.page ?? 1),
          pageSize,
        };
      } catch (error) {
        return preserveKnownError(error);
      }
    },

    async setUrgency(input: SetOpportunityUrgencyInput): Promise<OpportunityUrgencyResult> {
      const opportunityId = cleanText(input.opportunityId, 'O ID da oportunidade', 255);
      const actionId = cleanText(input.actionId, 'O ID da ação', 255);
      const actor = cleanText(input.actor, 'O ator', MAX_ACTOR_LENGTH);
      const expectedVersion = validateVersion(input.expectedVersion);
      if (typeof input.isUrgent !== 'boolean') {
        throw new OpportunityActionInputError('O estado de urgência é inválido.');
      }
      const now = nowDate(input.now, nowFactory);
      try {
        return await getDb().transaction(async (database) => {
          const deal = await lockOpportunity(database, opportunityId);
          assertOpenOpportunity(deal.status);
          const action = await lockAction(database, actionId, opportunityId);
          assertExpectedAction(action, expectedVersion);
          const [updated] = await database
            .update(crmDeals)
            .set({ isUrgent: input.isUrgent, updatedAt: now })
            .where(eq(crmDeals.id, opportunityId))
            .returning({ id: crmDeals.id, isUrgent: crmDeals.isUrgent });
          if (!updated) throw new ActionConflictError();
          // `actor` is intentionally validated above. Urgency is a property of
          // the opportunity, while action history remains the source of truth
          // for schedule transitions; no generic priority history is created.
          void actor;
          return {
            opportunityId: updated.id,
            actionId: action.id,
            version: action.version,
            isUrgent: updated.isUrgent,
          };
        });
      } catch (error) {
        return preserveKnownError(error);
      }
    },

    async createAction(
      input: CreateOpportunityActionInput
    ): Promise<OpportunityActionCommandResult> {
      const opportunityId = cleanText(input.opportunityId, 'O ID da oportunidade', 255);
      const actor = cleanText(input.actor, 'O ator', MAX_ACTOR_LENGTH);
      const schedule = normalizeSchedule(input);
      const transitionOrigin = validateTransitionOrigin(input.transitionOrigin ?? input.origin);
      const now = nowDate(input.now, nowFactory);
      try {
        return await getDb().transaction(async (database) => {
          const deal = await lockOpportunity(database, opportunityId);
          assertOpenOpportunity(deal.status);
          const active = await activeAction(database, opportunityId);
          if (!active) {
            const action = await insertAction(
              database,
              opportunityId,
              idFactory(),
              schedule,
              actor,
              now,
              1
            );
            return {
              actionId: action.actionId,
              opportunityId,
              state: 'active',
              version: action.version,
              action,
              successor: null,
              closed: false,
            };
          }
          if (!input.replaceActionId || input.replaceActionId !== active.id) {
            throw new ActionConflictError('A oportunidade já possui uma próxima ação ativa.');
          }
          const expectedVersion = validateVersion(input.expectedVersion);
          assertExpectedAction(active, expectedVersion);
          return replaceActiveAction(
            database,
            active,
            schedule,
            actor,
            transitionOrigin,
            schedule.reason,
            now,
            idFactory
          );
        });
      } catch (error) {
        return preserveKnownError(error);
      }
    },

    async rescheduleAction(
      input: RescheduleOpportunityActionInput
    ): Promise<OpportunityActionCommandResult> {
      const actionId = cleanText(input.actionId, 'O ID da ação', 255);
      const actor = cleanText(input.actor, 'O ator', MAX_ACTOR_LENGTH);
      const expectedVersion = validateVersion(input.expectedVersion);
      const schedule = normalizeSchedule(input);
      const transitionOrigin = validateTransitionOrigin(input.transitionOrigin ?? input.origin);
      const now = nowDate(input.now, nowFactory);
      try {
        return await getDb().transaction(async (database) => {
          const [reference] = await database
            .select({ opportunityId: opportunityNextActions.opportunityId })
            .from(opportunityNextActions)
            .where(eq(opportunityNextActions.id, actionId))
            .limit(1);
          if (!reference) throw new ActionNotFoundError();
          const deal = await lockOpportunity(database, reference.opportunityId);
          assertOpenOpportunity(deal.status);
          const active = await lockAction(database, actionId, reference.opportunityId);
          assertExpectedAction(active, expectedVersion);
          return replaceActiveAction(
            database,
            active,
            schedule,
            actor,
            transitionOrigin,
            schedule.reason,
            now,
            idFactory
          );
        });
      } catch (error) {
        return preserveKnownError(error);
      }
    },

    async completeAction(
      input: CompleteOpportunityActionInput
    ): Promise<OpportunityActionCommandResult> {
      const actionId = cleanText(input.actionId, 'O ID da ação', 255);
      const actor = cleanText(input.actor, 'O ator', MAX_ACTOR_LENGTH);
      const expectedVersion = validateVersion(input.expectedVersion);
      const hasSuccessor = input.successor !== undefined;
      const hasClose = input.close !== undefined;
      if (hasSuccessor === hasClose) {
        throw new OpportunityActionInputError(
          'Concluir exige criar uma ação sucessora ou fechar a oportunidade com um motivo.'
        );
      }
      const successor = hasSuccessor ? normalizeSchedule(input.successor!) : null;
      const transitionOrigin = validateTransitionOrigin(
        input.transitionOrigin ?? successor?.origin
      );
      const closeReason = hasClose
        ? cleanText(input.close?.reason, 'O motivo do fechamento', 500)
        : null;
      const now = nowDate(input.now, nowFactory);
      try {
        return await getDb().transaction(async (database) => {
          const [reference] = await database
            .select({ opportunityId: opportunityNextActions.opportunityId })
            .from(opportunityNextActions)
            .where(eq(opportunityNextActions.id, actionId))
            .limit(1);
          if (!reference) throw new ActionNotFoundError();
          const deal = await lockOpportunity(database, reference.opportunityId);
          assertOpenOpportunity(deal.status);
          const active = await lockAction(database, actionId, reference.opportunityId);
          assertExpectedAction(active, expectedVersion);

          if (successor) {
            return completeWithSuccessor(
              database,
              active,
              successor,
              actor,
              transitionOrigin,
              active.reason,
              now,
              idFactory
            );
          }

          const changed = await database
            .update(opportunityNextActions)
            .set({
              state: 'completed',
              updatedAt: now,
              transitionActor: actor,
              transitionAt: now,
              transitionOrigin,
              transitionReason: closeReason,
              replacedById: null,
            })
            .where(
              and(
                eq(opportunityNextActions.id, active.id),
                eq(opportunityNextActions.state, 'active'),
                eq(opportunityNextActions.version, active.version)
              )
            )
            .returning();
          if (changed.length !== 1) throw new ActionConflictError();
          const [closed] = await database
            .update(crmDeals)
            .set({ status: 'Perdido', lostReason: closeReason, updatedAt: now })
            .where(eq(crmDeals.id, reference.opportunityId))
            .returning();
          if (!closed) throw new ActionConflictError();
          return {
            actionId: active.id,
            opportunityId: reference.opportunityId,
            state: 'completed',
            version: active.version + 1,
            action: rowRecord(changed[0]),
            successor: null,
            closed: true,
          };
        });
      } catch (error) {
        return preserveKnownError(error);
      }
    },

    async recordManualContact(input: ManualContactInput): Promise<ManualContactCommandResult> {
      const normalized = normalizeManualContact(input);
      const fingerprint = manualContactFingerprint(normalized);
      const now = nowDate(input.now, nowFactory);
      try {
        return await getDb().transaction(async (database) => {
          const alreadyRecorded = await findManualContactEvent(database, normalized.commandId);
          if (alreadyRecorded) return replayManualContact(database, alreadyRecorded, fingerprint);

          // The opportunity lock is the serialization point for all commands
          // that can replace its one active action.  A retry deliberately
          // checks the immutable event after taking this lock: its old action
          // may already be completed or replaced by the first attempt.
          const deal = await lockOpportunity(database, normalized.opportunityId);
          const existing = await findManualContactEvent(database, normalized.commandId);
          if (existing) return replayManualContact(database, existing, fingerprint);

          assertOpenOpportunity(deal.status);
          const active = await lockAction(database, normalized.actionId, normalized.opportunityId);
          assertExpectedAction(active, normalized.expectedVersion);

          const eventId = idFactory();
          const continuation = normalized.continuation;
          const actionResult = continuation.schedule
            ? await completeWithSuccessor(
                database,
                active,
                continuation.schedule,
                normalized.actor,
                'manual',
                active.reason,
                now,
                idFactory
              )
            : await completeWithClose(
                database,
                deal,
                active,
                normalized.actor,
                continuation.closeReason!,
                now
              );

          if (normalized.countsAsFollowUp) {
            const [updated] = await database
              .update(crmDeals)
              .set({
                followUpStage: sql`${crmDeals.followUpStage} + 1`,
                updatedAt: now,
              })
              .where(eq(crmDeals.id, normalized.opportunityId))
              .returning({ id: crmDeals.id });
            if (!updated) throw new ActionConflictError();
          }

          const [event] = await database
            .insert(manualContactEvents)
            .values({
              id: eventId,
              commandId: normalized.commandId,
              commandFingerprint: fingerprint,
              opportunityId: normalized.opportunityId,
              actionId: normalized.actionId,
              contactType: normalized.contactType,
              occurredAt: normalized.occurredAt,
              note: normalized.note,
              resultCode: normalized.resultCode,
              countsAsFollowUp: normalized.countsAsFollowUp,
              source: 'operator_statement',
              actor: normalized.actor,
              createdAt: now,
              continuationType: continuation.type,
              successorActionId: actionResult.successor?.actionId || null,
              closeReason: continuation.closeReason,
              resultVersion: actionResult.version,
              closed: actionResult.closed,
            })
            .returning();
          if (!event) throw new OpportunityActionRepositoryError();

          return {
            ...actionResult,
            eventId: event.id,
            commandId: event.commandId,
            contactType: normalized.contactType,
            occurredAt: normalized.occurredAt.toISOString(),
            note: normalized.note,
            resultCode: normalized.resultCode,
            countsAsFollowUp: normalized.countsAsFollowUp,
            continuationType: continuation.type,
            source: 'operator_statement' as const,
          };
        });
      } catch (error) {
        // A command key is unique across opportunities too.  If two callers
        // race before either can lock its different opportunity, PostgreSQL
        // may report that unique conflict instead of letting the second
        // transaction observe the event.  Replay the now-committed winner.
        if (isUniqueViolation(error)) {
          const winner = await findManualContactEvent(getDb(), normalized.commandId);
          if (winner) return replayManualContact(getDb(), winner, fingerprint);
        }
        return preserveKnownError(error);
      }
    },

    async listHistory(opportunityId: string): Promise<OpportunityActionHistoryEntry[]> {
      const normalizedId = cleanText(opportunityId, 'O ID da oportunidade', 255);
      try {
        const rows = await getDb()
          .select()
          .from(opportunityNextActions)
          .where(eq(opportunityNextActions.opportunityId, normalizedId))
          .orderBy(asc(opportunityNextActions.createdAt), asc(opportunityNextActions.id));
        const manualEvents = await getDb()
          .select()
          .from(manualContactEvents)
          .where(eq(manualContactEvents.opportunityId, normalizedId))
          .orderBy(asc(manualContactEvents.createdAt), asc(manualContactEvents.id));
        const history: OpportunityActionHistoryEntry[] = [];
        const rowsById = new Map(rows.map((row) => [row.id, row]));
        const manualEventsByActionId = new Map<
          string,
          Array<typeof manualContactEvents.$inferSelect>
        >();
        for (const event of manualEvents) {
          const entries = manualEventsByActionId.get(event.actionId) || [];
          entries.push(event);
          manualEventsByActionId.set(event.actionId, entries);
        }
        const successorIds = new Set(
          rows.map((row) => row.replacedById).filter((id): id is string => Boolean(id))
        );
        const visited = new Set<string>();

        function appendManualContact(event: typeof manualContactEvents.$inferSelect): void {
          history.push({
            eventId: event.id,
            actionId: event.actionId,
            type: 'manual_contact',
            actor: event.actor,
            timestamp: isoDate(event.createdAt),
            origin: 'manual',
            reason: event.resultCode,
            state: 'completed',
            replacementActionId: event.successorActionId,
            contactType: event.contactType as ManualContactType,
            occurredAt: isoDate(event.occurredAt),
            note: event.note,
            resultCode: event.resultCode as ManualContactResultCode,
            countsAsFollowUp: event.countsAsFollowUp,
            source: 'operator_statement',
            continuationType: event.continuationType as ManualContactContinuationType,
            successorActionId: event.successorActionId,
            closeReason: event.closeReason,
          });
        }

        function appendAction(row: typeof opportunityNextActions.$inferSelect): void {
          if (visited.has(row.id)) return;
          visited.add(row.id);
          const action = rowRecord(row);
          history.push({
            eventId: `${action.actionId}:created`,
            actionId: action.actionId,
            type: 'created',
            actor: action.actor,
            timestamp: action.createdAt,
            origin: action.origin,
            reason: action.reason,
            state: action.state,
            replacementActionId: action.replacedById,
          });
          if (
            action.transitionAt &&
            action.transitionActor &&
            action.transitionOrigin &&
            action.transitionReason
          ) {
            const type: OpportunityActionHistoryType =
              action.state === 'completed'
                ? 'completed'
                : action.replacedById
                  ? 'rescheduled'
                  : 'replaced';
            history.push({
              eventId: `${action.actionId}:${type}`,
              actionId: action.actionId,
              type,
              actor: action.transitionActor,
              timestamp: action.transitionAt,
              origin: action.transitionOrigin,
              reason: action.transitionReason,
              state: action.state,
              replacementActionId: action.replacedById,
            });
          }

          for (const event of manualEventsByActionId.get(action.actionId) || []) {
            appendManualContact(event);
          }

          if (action.replacedById) {
            const successor = rowsById.get(action.replacedById);
            if (successor) appendAction(successor);
          }
        }

        // A command records the edge from the old row to its successor. Walking
        // those edges keeps same-timestamp events deterministic (the old row's
        // transition precedes the successor creation), even when a caller uses
        // one clock value for an entire transaction.
        for (const row of rows) {
          if (!successorIds.has(row.id)) appendAction(row);
        }
        for (const row of rows) {
          appendAction(row);
        }
        return history;
      } catch (error) {
        return preserveKnownError(error);
      }
    },
  };
}
