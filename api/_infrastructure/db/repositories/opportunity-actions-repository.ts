import { and, asc, eq, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';

import { addBusinessDays, calendarDateInSaoPaulo } from '../../../_shared/calendar-sao-paulo.js';
import { getDatabase, type AppDatabase } from '../client.js';
import { nextFollowUpCycleNumber } from './follow-up-cycle.js';
import {
  crmDeals,
  manualContactEvents,
  opportunityNextActions,
  quotationFollowUpAttemptHistory,
  quotationFollowUps,
  quotations,
} from '../schema.js';
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
export type FollowUpContinuityType = 'new_cycle' | 'manual_date';

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
const FOLLOW_UP_CONTINUITY_TYPES: readonly FollowUpContinuityType[] = [
  'new_cycle',
  'manual_date',
];
const FOLLOW_UP_DECISION_REASON_CODE = 'follow_up_decide_continuity';

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
  /** Source of the event action, when the opportunity anchor created it. */
  sourceQuotationId: string | null;
  sourceRevisionId: string | null;
  sourceDeliveryId: string | null;
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

export interface ContinueFollowUpInput {
  commandId: string;
  opportunityId: string;
  actionId: string;
  expectedVersion: number;
  type: FollowUpContinuityType;
  schedule: OpportunityActionScheduleInput;
  actor: string;
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

export interface AssociateInboundResponseInput {
  opportunityId: string;
  actionId?: string;
  expectedVersion: number;
  actor: string;
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
  continueFollowUp(input: ContinueFollowUpInput): Promise<OpportunityActionCommandResult>;
  listHistory(opportunityId: string): Promise<OpportunityActionHistoryEntry[]>;
  setUrgency(input: SetOpportunityUrgencyInput): Promise<OpportunityUrgencyResult>;
  associateInboundResponse(
    input: AssociateInboundResponseInput
  ): Promise<OpportunityActionCommandResult>;
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

interface NormalizedFollowUpContinuity {
  commandId: string;
  opportunityId: string;
  actionId: string;
  expectedVersion: number;
  type: FollowUpContinuityType;
  schedule: NormalizedSchedule;
  actor: string;
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

function normalizeFollowUpContinuity(input: ContinueFollowUpInput): NormalizedFollowUpContinuity {
  if (!FOLLOW_UP_CONTINUITY_TYPES.includes(input.type)) {
    throw new OpportunityActionInputError('A decisão de continuidade é inválida.');
  }
  return {
    commandId: cleanText(input.commandId, 'O ID do comando', 255),
    opportunityId: cleanText(input.opportunityId, 'O ID da oportunidade', 255),
    actionId: cleanText(input.actionId, 'O ID da ação', 255),
    expectedVersion: validateVersion(input.expectedVersion),
    type: input.type,
    schedule: normalizeSchedule({ ...input.schedule, origin: 'manual' }),
    actor: cleanText(input.actor, 'O ator', MAX_ACTOR_LENGTH),
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

function followUpContinuityFingerprint(input: NormalizedFollowUpContinuity): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        opportunityId: input.opportunityId,
        actionId: input.actionId,
        expectedVersion: input.expectedVersion,
        type: input.type,
        kind: input.schedule.kind,
        dueDate: input.schedule.dueDate,
        dueTime: input.schedule.dueTime,
        reasonCode: input.schedule.reasonCode,
        reason: input.schedule.reason,
      })
    )
    .digest('hex');
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
  source_quotation_id: string | null;
  source_revision_id: string | null;
  source_delivery_id: string | null;
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
  version: number,
  continuity?: { commandId: string; fingerprint: string; type: FollowUpContinuityType }
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
      continuityCommandId: continuity?.commandId,
      continuityCommandFingerprint: continuity?.fingerprint,
      continuityType: continuity?.type,
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
  idFactory: () => string,
  continuity?: { commandId: string; fingerprint: string; type: FollowUpContinuityType },
  successorIdOverride?: string,
): Promise<OpportunityActionCommandResult> {
  const successorId = successorIdOverride || idFactory();
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
    oldAction.version + 1,
    continuity
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

export interface ConfirmedFollowUpTransitionInput {
  database: ActionDatabase;
  opportunityId: string;
  current: typeof quotationFollowUps.$inferSelect;
  stage: number;
  confirmedAt: Date;
  source: 'worker' | 'manual';
  /** The worker can treat a pre-stage alternative quotation as attempt 2. */
  attemptNumber?: 1 | 2;
  actor: string;
  providerMessageId?: string | null;
  confirmationCommandId?: string | null;
  activeAction?: typeof opportunityNextActions.$inferSelect | null;
  idFactory: () => string;
}

function followUpTransitionSchedule(
  attempt: 1 | 2,
  confirmedAt: Date,
  origin: OpportunityActionOrigin,
): NormalizedSchedule {
  const nextDate = addBusinessDays(calendarDateInSaoPaulo(confirmedAt), 3);
  return {
    kind: 'customer_contact',
    dueDate: nextDate,
    dueTime: null,
    scheduleType: 'date_only',
    dueAt: new Date(`${nextDate}T00:00:00-03:00`),
    reason: attempt === 1 ? 'Segundo retorno' : 'Decidir continuidade',
    reasonCode: attempt === 1 ? 'follow_up_second_return' : FOLLOW_UP_DECISION_REASON_CODE,
    origin,
  };
}

/**
 * Applies the durable commercial consequence of a confirmed return. Both the
 * provider worker and the operator's silent manual contact use this seam while
 * holding the opportunity row lock. The current queue row is reused; the
 * immutable attempt snapshot is written once to the history table first.
 */
export async function advanceConfirmedFollowUp(
  input: ConfirmedFollowUpTransitionInput,
): Promise<OpportunityActionCommandResult> {
  const {
    database,
    opportunityId,
    current,
    stage,
    confirmedAt,
    source,
    actor,
    providerMessageId = null,
    confirmationCommandId = null,
    idFactory,
  } = input;
  const attempt = input.attemptNumber ?? Number(current.attemptNumber);
  if (attempt !== stage + 1 || (attempt !== 1 && attempt !== 2)) {
    throw new ActionConflictError('A tentativa de follow-up não está no ciclo atual.');
  }
  if (source === 'worker' && !providerMessageId) {
    throw new ActionConflictError('A confirmação do provedor é obrigatória.');
  }

  const nextSchedule = followUpTransitionSchedule(
    attempt,
    confirmedAt,
    source === 'worker' ? 'event' : 'manual',
  );

  const currentAction =
    input.activeAction === undefined
      ? await activeAction(database, opportunityId)
      : input.activeAction;
  const sourceActionId = current.sourceActionId || currentAction?.id || null;
  const successorId = idFactory();
  const actionResult = currentAction
    ? await completeWithSuccessor(
        database,
        currentAction,
        nextSchedule,
        actor,
        source === 'worker' ? 'event' : 'manual',
        source === 'worker'
          ? attempt === 1
            ? 'Primeiro retorno enviado'
            : 'Segundo retorno enviado'
          : attempt === 1
            ? 'Primeiro retorno registrado manualmente'
            : 'Segundo retorno registrado manualmente',
        confirmedAt,
        idFactory,
      )
    : {
        actionId: successorId,
        opportunityId,
        state: 'active' as const,
        version: 1,
        action: null,
        successor: await insertAction(
          database,
          opportunityId,
          successorId,
          nextSchedule,
          actor,
          confirmedAt,
          1,
        ),
        closed: false,
      };
  const nextActionId = actionResult.successor?.actionId;
  if (!nextActionId) throw new OpportunityActionRepositoryError();
  const persistedNextDueAt = actionResult.successor
    ? new Date(actionResult.successor.dueAt)
    : nextSchedule.dueAt;

  const historyValues = {
    id: idFactory(),
    opportunityId,
    quotationId: current.quotationId,
    followUpId: current.id,
    cycleNumber: current.cycleNumber,
    attemptNumber: attempt,
    revisionId: current.revisionId,
    deliveryId: current.deliveryId,
    sourceActionId,
    instance: current.instance,
    providerConversationId: current.providerConversationId,
    canonicalPhone: current.canonicalPhone,
    eligibilityVersion: current.eligibilityVersion,
    messageSnapshot: current.messageSnapshot,
    state: source === 'worker' ? 'sent' : 'manual',
    closedReason: current.closedReason,
    leaseToken: current.leaseToken,
    leaseUntil: current.leaseUntil,
    transportStartedAt: current.transportStartedAt,
    providerMessageId: source === 'worker' ? providerMessageId : null,
    firstProviderReceiptAt: current.firstProviderReceiptAt,
    dueAt: current.dueAt,
    approvedAt: current.approvedAt,
    sentAt: source === 'worker' ? confirmedAt : current.sentAt,
    closedAt: confirmedAt,
    confirmationSource: source,
    confirmationCommandId,
    confirmedAt,
    createdAt: confirmedAt,
  } as const;
  await database.insert(quotationFollowUpAttemptHistory).values(historyValues);

  await database
    .update(crmDeals)
    .set({ followUpStage: attempt, updatedAt: confirmedAt })
    .where(and(eq(crmDeals.id, opportunityId), eq(crmDeals.followUpStage, stage)));

  const nextState = attempt === 1 ? 'waiting' : 'sent';
  await database
    .update(quotationFollowUps)
    .set({
      attemptNumber: 2,
      sourceActionId: nextActionId,
      state: nextState,
      closedReason: null,
      approvedOpportunityId: null,
      leaseToken: null,
      leaseUntil: null,
      transportStartedAt: null,
      providerMessageId: attempt === 1 ? null : source === 'worker' ? providerMessageId : null,
      firstProviderReceiptAt: current.firstProviderReceiptAt,
      dueAt: attempt === 1 ? persistedNextDueAt : current.dueAt,
      eligibilityVersion: null,
      messageSnapshot: null,
      approvedAt: null,
      sentAt: attempt === 1 ? null : source === 'worker' ? confirmedAt : null,
      closedAt: attempt === 1 ? null : confirmedAt,
      updatedAt: confirmedAt,
    })
    .where(eq(quotationFollowUps.id, current.id));

  if (attempt === 2) {
    const startedOtherTransports = await database.execute(sql`
      SELECT follow_up.id
      FROM quotation_follow_ups follow_up
      JOIN quotations quotation ON quotation.id = follow_up.quotation_id
      WHERE follow_up.id <> ${current.id}::uuid
        AND COALESCE(
          quotation.opportunity_id,
          (SELECT legacy.id FROM crm_deals legacy
           WHERE legacy.quotation_id = quotation.id
           ORDER BY legacy.updated_at DESC, legacy.id DESC
           LIMIT 1)
        ) = ${opportunityId}::uuid
        AND follow_up.state = 'processing'
        AND follow_up.transport_started_at IS NOT NULL
      FOR UPDATE OF follow_up
    `);
    if (Array.from(startedOtherTransports).length) {
      throw new ActionConflictError('Outro envio técnico do negócio já começou. Recarregue a fila.');
    }
    await database.execute(sql`
      UPDATE quotation_follow_ups AS follow_up
      SET state = 'dismissed',
          closed_reason = 'already_attempted',
          closed_at = ${confirmedAt.toISOString()}::timestamptz,
          approved_opportunity_id = NULL,
          eligibility_version = NULL,
          message_snapshot = NULL,
          approved_at = NULL,
          lease_token = NULL,
          lease_until = NULL,
          transport_started_at = NULL,
          updated_at = ${confirmedAt.toISOString()}::timestamptz
      FROM quotations quotation
      WHERE quotation.id = follow_up.quotation_id
        AND follow_up.id <> ${current.id}::uuid
        AND COALESCE(
          quotation.opportunity_id,
          (SELECT legacy.id FROM crm_deals legacy
           WHERE legacy.quotation_id = quotation.id
           ORDER BY legacy.updated_at DESC, legacy.id DESC
           LIMIT 1)
        ) = ${opportunityId}::uuid
        AND follow_up.state IN ('awaiting_receipt', 'waiting', 'ready', 'held', 'approved')
    `);
  }

  return actionResult;
}

export interface ApplyInboundResponseTransitionInput {
  database: ActionDatabase;
  opportunityId: string;
  /** Trusted instant of the inbound message driving the transition. */
  occurredAt: Date;
  idFactory: () => string;
  actor?: string;
}

export const INBOUND_NEEDS_RESPONSE_REASON_CODE = 'inbound_needs_response';
export const ASSOCIATE_RESPONSE_REASON_CODE = 'associate_response';
export const VERIFY_CONVERSATION_REASON_CODE = 'verify_conversation';
export const ASSOCIATE_RESPONSE_REASON = 'Associar resposta';
export const VERIFY_CONVERSATION_REASON = 'Verificar conversa';


/**
 * An unambiguously associated inbound message replaces the pending return
 * action with "Preciso responder" (#249). Idempotent by current state: when
 * the active action already carries this event's transition
 * (reasonCode 'inbound_needs_response') nothing new is written and the
 * current result is returned. The caller supplies the database (pool or
 * transaction); no transaction is opened here.
 */
export async function applyInboundResponseTransition(
  input: ApplyInboundResponseTransitionInput,
): Promise<OpportunityActionCommandResult> {
  const { database, opportunityId, occurredAt } = input;
  const actor = input.actor || 'system';
  const action = await activeAction(database, opportunityId);
  if (action?.reasonCode === INBOUND_NEEDS_RESPONSE_REASON_CODE) {
    return {
      actionId: action.id,
      opportunityId,
      state: 'active',
      version: action.version,
      action: rowRecord(action),
      successor: null,
      closed: false,
    };
  }
  if (!action) {
    throw new ActionNotFoundError('Nenhuma ação ativa para substituir pela resposta do cliente.');
  }
  const dueDate = calendarDateInSaoPaulo(occurredAt);
  return completeWithSuccessor(
    database,
    action,
    {
      kind: 'review',
      dueDate,
      dueTime: null,
      scheduleType: 'date_only',
      dueAt: new Date(`${dueDate}T00:00:00-03:00`),
      reason: 'Preciso responder',
      reasonCode: INBOUND_NEEDS_RESPONSE_REASON_CODE,
      origin: 'event',
    },
    actor,
    'event',
    'Cliente respondeu',
    occurredAt,
    input.idFactory,
  );
}

function reviewSchedule(
  occurredAt: Date,
  reason: string,
  reasonCode: string,
): NormalizedSchedule {
  const dueDate = calendarDateInSaoPaulo(occurredAt);
  return {
    kind: 'review',
    dueDate,
    dueTime: null,
    scheduleType: 'date_only',
    dueAt: new Date(`${dueDate}T00:00:00-03:00`),
    reason,
    reasonCode,
    origin: 'event',
  };
}

async function applyReviewReasonTransition(
  input: ApplyInboundResponseTransitionInput,
  reason: string,
  reasonCode: string,
  transitionReason: string,
): Promise<OpportunityActionCommandResult> {
  const { database, opportunityId, occurredAt } = input;
  const actor = input.actor || 'system';
  const action = await activeAction(database, opportunityId);
  if (action?.reasonCode === reasonCode) {
    return {
      actionId: action.id,
      opportunityId,
      state: 'active',
      version: action.version,
      action: rowRecord(action),
      successor: null,
      closed: false,
    };
  }
  if (!action) {
    throw new ActionNotFoundError(
      'Nenhuma ação ativa para substituir pela revisão comercial.',
    );
  }
  return completeWithSuccessor(
    database,
    action,
    reviewSchedule(occurredAt, reason, reasonCode),
    actor,
    'event',
    transitionReason,
    occurredAt,
    input.idFactory,
  );
}

/**
 * Contact-level ambiguity: replace the host opportunity's pending action with
 * "Associar resposta" (#250). Idempotent when that reason is already active.
 */
export async function applyAssociateResponseTransition(
  input: ApplyInboundResponseTransitionInput,
): Promise<OpportunityActionCommandResult> {
  return applyReviewReasonTransition(
    input,
    ASSOCIATE_RESPONSE_REASON,
    ASSOCIATE_RESPONSE_REASON_CODE,
    'Resposta ambígua entre oportunidades',
  );
}

/**
 * Missing or inconclusive telemetry becomes "Verificar conversa" (#250). Does
 * not claim customer silence.
 */
export async function applyVerifyConversationTransition(
  input: ApplyInboundResponseTransitionInput,
): Promise<OpportunityActionCommandResult> {
  return applyReviewReasonTransition(
    input,
    VERIFY_CONVERSATION_REASON,
    VERIFY_CONVERSATION_REASON_CODE,
    'Telemetria insuficiente para afirmar silêncio',
  );
}

/**
 * Operator resolves an Associar resposta alert onto one opportunity. The chosen
 * demand receives Preciso responder; a leftover associate alert on another
 * opportunity of the same client is cancelled without touching unrelated
 * contacts (#250).
 */
export async function resolveAssociateResponseToOpportunity(input: {
  database: ActionDatabase;
  clientId: string;
  opportunityId: string;
  occurredAt: Date;
  idFactory: () => string;
  actor: string;
}): Promise<OpportunityActionCommandResult> {
  const { database, clientId, opportunityId, occurredAt, idFactory, actor } = input;
  const siblingRows = await database
    .select({
      id: opportunityNextActions.id,
      opportunityId: opportunityNextActions.opportunityId,
      version: opportunityNextActions.version,
    })
    .from(opportunityNextActions)
    .innerJoin(crmDeals, eq(crmDeals.id, opportunityNextActions.opportunityId))
    .where(
      and(
        eq(crmDeals.clientId, clientId),
        eq(opportunityNextActions.state, 'active'),
        eq(opportunityNextActions.reasonCode, ASSOCIATE_RESPONSE_REASON_CODE),
        sql`${opportunityNextActions.opportunityId} <> ${opportunityId}`,
      ),
    );
  for (const sibling of siblingRows) {
    await database
      .update(opportunityNextActions)
      .set({
        state: 'cancelled',
        updatedAt: occurredAt,
        transitionActor: actor,
        transitionAt: occurredAt,
        transitionOrigin: 'manual',
        transitionReason: 'Resposta associada a outra oportunidade',
        replacedById: null,
      })
      .where(
        and(
          eq(opportunityNextActions.id, sibling.id),
          eq(opportunityNextActions.state, 'active'),
          eq(opportunityNextActions.version, sibling.version),
        ),
      );
  }
  return applyInboundResponseTransition({
    database,
    opportunityId,
    occurredAt,
    idFactory,
    actor,
  });
}


async function archiveManualFollowUpAttempt(
  database: ActionDatabase,
  input: {
    opportunityId: string;
    current: typeof quotationFollowUps.$inferSelect;
    stage: number;
    confirmedAt: Date;
    commandId: string;
    successorActionId?: string | null;
    idFactory: () => string;
  },
): Promise<void> {
  const {
    current,
    opportunityId,
    stage,
    confirmedAt,
    commandId,
    successorActionId,
    idFactory,
  } = input;
  if (Number(current.attemptNumber) !== stage + 1) {
    throw new ActionConflictError('A tentativa de follow-up não está no ciclo atual.');
  }
  await database.insert(quotationFollowUpAttemptHistory).values({
    id: idFactory(),
    opportunityId,
    quotationId: current.quotationId,
    followUpId: current.id,
    cycleNumber: current.cycleNumber,
    attemptNumber: current.attemptNumber,
    revisionId: current.revisionId,
    deliveryId: current.deliveryId,
    sourceActionId: current.sourceActionId,
    instance: current.instance,
    providerConversationId: current.providerConversationId,
    canonicalPhone: current.canonicalPhone,
    eligibilityVersion: current.eligibilityVersion,
    messageSnapshot: current.messageSnapshot,
    state: 'manual',
    closedReason: 'already_handled',
    leaseToken: current.leaseToken,
    leaseUntil: current.leaseUntil,
    transportStartedAt: current.transportStartedAt,
    providerMessageId: null,
    firstProviderReceiptAt: current.firstProviderReceiptAt,
    dueAt: current.dueAt,
    approvedAt: current.approvedAt,
    sentAt: null,
    closedAt: confirmedAt,
    confirmationSource: 'manual',
    confirmationCommandId: commandId,
    confirmedAt,
    createdAt: confirmedAt,
  });
  await database
    .update(crmDeals)
    .set({ followUpStage: stage + 1, updatedAt: confirmedAt })
    .where(and(eq(crmDeals.id, opportunityId), eq(crmDeals.followUpStage, stage)));
  await database
    .update(quotationFollowUps)
    .set({
      state: 'sent',
      attemptNumber: 2,
      sourceActionId: successorActionId || current.sourceActionId,
      closedReason: 'already_handled',
      closedAt: confirmedAt,
      approvedOpportunityId: null,
      eligibilityVersion: null,
      messageSnapshot: null,
      approvedAt: null,
      leaseToken: null,
      leaseUntil: null,
      transportStartedAt: null,
      providerMessageId: null,
      sentAt: null,
      updatedAt: confirmedAt,
    })
    .where(eq(quotationFollowUps.id, current.id));
}

async function closePendingTechnicalFollowUp(
  database: ActionDatabase,
  opportunityId: string,
  actionId: string,
  now: Date,
): Promise<void> {
  const rows = await database
    .select({ followUp: quotationFollowUps })
    .from(quotationFollowUps)
    .innerJoin(quotations, eq(quotations.id, quotationFollowUps.quotationId))
    .where(
      and(
        sql`COALESCE(
          ${quotations.opportunityId},
          (SELECT legacy.id FROM crm_deals legacy
           WHERE legacy.quotation_id = ${quotations.id}
           ORDER BY legacy.updated_at DESC, legacy.id DESC
           LIMIT 1)
        ) = ${opportunityId}::uuid`,
        sql`${quotationFollowUps.state} IN ('awaiting_receipt', 'waiting', 'ready', 'held', 'approved', 'processing')`,
      ),
    )
    .orderBy(
      sql`CASE WHEN ${quotationFollowUps.sourceActionId} = ${actionId}::uuid THEN 0 ELSE 1 END`,
      sql`${quotationFollowUps.cycleNumber} DESC`,
      sql`${quotationFollowUps.attemptNumber} DESC`,
    )
    .for('update');
  const current = rows[0]?.followUp;
  if (!current) return;
  if (current.state === 'processing' && current.transportStartedAt) {
    throw new ActionConflictError('O envio técnico já começou. Recarregue a fila.');
  }
  await database
    .update(quotationFollowUps)
    .set({
      state: 'dismissed',
      closedReason: 'already_handled',
      closedAt: now,
      approvedOpportunityId: null,
      eligibilityVersion: null,
      messageSnapshot: null,
      approvedAt: null,
      leaseToken: null,
      leaseUntil: null,
      transportStartedAt: null,
      updatedAt: now,
    })
    .where(eq(quotationFollowUps.id, current.id));
}

async function lockCurrentFollowUp(
  database: ActionDatabase,
  opportunityId: string,
  actionId: string,
  options: { rejectStartedTransport?: boolean } = {},
): Promise<typeof quotationFollowUps.$inferSelect | null> {
  const rows = await database
    .select({ followUp: quotationFollowUps })
    .from(quotationFollowUps)
    .innerJoin(quotations, eq(quotations.id, quotationFollowUps.quotationId))
    .where(
      sql`COALESCE(
        ${quotations.opportunityId},
        (SELECT legacy.id FROM crm_deals legacy
         WHERE legacy.quotation_id = ${quotations.id}
         ORDER BY legacy.updated_at DESC, legacy.id DESC
         LIMIT 1)
      ) = ${opportunityId}::uuid`,
    )
    .orderBy(
      sql`CASE WHEN ${quotationFollowUps.sourceActionId} = ${actionId}::uuid THEN 0 ELSE 1 END`,
      sql`CASE WHEN EXISTS (
        SELECT 1 FROM opportunity_delivery_anchors anchor
        WHERE anchor.created_action_id = ${actionId}::uuid
          AND anchor.quotation_id = ${quotationFollowUps.quotationId}
      ) THEN 0 ELSE 1 END`,
      sql`${quotationFollowUps.cycleNumber} DESC`,
      sql`${quotationFollowUps.attemptNumber} DESC`,
      sql`${quotationFollowUps.updatedAt} DESC`,
      asc(quotationFollowUps.id),
    )
    .for('update');
  if (
    options.rejectStartedTransport &&
    rows.some(
      ({ followUp }) => followUp.state === 'processing' && followUp.transportStartedAt !== null,
    )
  ) {
    throw new ActionConflictError('Outro envio técnico do negócio já começou. Recarregue a fila.');
  }
  return rows[0]?.followUp || null;
}

type NewCycleDelivery = {
  quotationId: string;
  revisionId: string;
  deliveryId: string;
  phone: string;
  receiptAt: Date | null;
};

type FollowUpIdentity = {
  instance: string;
  providerConversationId: string;
  canonicalPhone: string;
};

function phoneDigits(value: unknown): string {
  return String(value || '').replace(/[^0-9]/g, '');
}

async function eligibleNewCycleDelivery(
  database: ActionDatabase,
  opportunityId: string,
): Promise<NewCycleDelivery | null> {
  const result = await database.execute(sql`
    SELECT
      q.id AS quotation_id,
      r.id AS revision_id,
      d.id AS delivery_id,
      d.phone,
      MAX(COALESCE(step.delivered_at, step.read_at)) AS receipt_at
    FROM quotations q
    JOIN quote_revisions r ON r.quotation_id = q.id
    JOIN quotation_deliveries d ON d.revision_id = r.id
    JOIN quotation_delivery_steps step ON step.delivery_id = d.id
    JOIN clients client ON client.id = q.client_id
    LEFT JOIN LATERAL (
      SELECT legacy.id
      FROM crm_deals legacy
      WHERE q.opportunity_id IS NULL AND legacy.quotation_id = q.id
      ORDER BY legacy.updated_at DESC, legacy.id DESC
      LIMIT 1
    ) legacy ON true
    WHERE COALESCE(q.opportunity_id, legacy.id) = ${opportunityId}::uuid
      AND q.status = 'emitido'
      AND client.arquivado = false
      AND d.state = 'delivered'
      AND d.completion_source = 'provider_receipt'
    GROUP BY q.id, r.id, d.id
    HAVING COUNT(step.id) > 0
       AND COUNT(*) FILTER (WHERE step.delivered_at IS NULL AND step.read_at IS NULL) = 0
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 1
  `);
  const row = Array.from(result as Iterable<Record<string, unknown>>)[0];
  if (!row) return null;
  const receiptAt = row.receipt_at instanceof Date
    ? new Date(row.receipt_at.getTime())
    : row.receipt_at == null
      ? null
      : new Date(String(row.receipt_at));
  return {
    quotationId: String(row.quotation_id),
    revisionId: String(row.revision_id),
    deliveryId: String(row.delivery_id),
    phone: String(row.phone || ''),
    receiptAt: receiptAt && !Number.isNaN(receiptAt.getTime()) ? receiptAt : null,
  };
}

async function deliveryPhone(
  database: ActionDatabase,
  deliveryId: string,
): Promise<string> {
  const result = await database.execute(sql`
    SELECT phone FROM quotation_deliveries WHERE id = ${deliveryId}::uuid LIMIT 1
  `);
  const row = Array.from(result as Iterable<Record<string, unknown>>)[0];
  return String(row?.phone || '');
}

async function verifiedFollowUpIdentity(
  database: ActionDatabase,
  instance: string,
  candidatePhone: string,
  candidateConversation: string,
): Promise<FollowUpIdentity> {
  const result = await database.execute(sql`
    SELECT activity.provider_conversation_id, activity.canonical_phone
    FROM whatsapp_contact_activity activity
    WHERE activity.instance = ${instance}
      AND activity.identity_status IN ('verified', 'derived')
      AND activity.blocked_at IS NULL
      AND activity.canonical_phone ~ '^[0-9]{10,15}$'
      AND (
        (${candidatePhone} <> '' AND activity.canonical_phone = ${candidatePhone})
        OR (
          ${candidateConversation} <> ''
          AND activity.provider_conversation_id = ${candidateConversation}
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM whatsapp_follow_up_ingestion_health health
        WHERE health.instance = ${instance}
          AND health.blocked_at IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM whatsapp_contact_activity blocked
        WHERE blocked.instance = ${instance}
          AND blocked.blocked_at IS NOT NULL
          AND (
            blocked.provider_conversation_id = activity.provider_conversation_id
            OR blocked.canonical_phone = activity.canonical_phone
          )
      )
    ORDER BY CASE WHEN activity.canonical_phone = ${candidatePhone} THEN 0 ELSE 1 END,
             activity.updated_at DESC,
             activity.id
    LIMIT 1
  `);
  const row = Array.from(result as Iterable<Record<string, unknown>>)[0];
  const canonicalPhone = phoneDigits(row?.canonical_phone);
  const providerConversationId = String(row?.provider_conversation_id || '').trim();
  if (!row || !/^[0-9]{10,15}$/.test(canonicalPhone) || !providerConversationId) {
    throw new ActionConflictError(
      'A identidade do contato não foi validada na instância configurada.',
    );
  }
  return { instance, providerConversationId, canonicalPhone };
}

async function materializeNewCycleFollowUp(
  database: ActionDatabase,
  opportunityId: string,
  current: typeof quotationFollowUps.$inferSelect | null,
  successorActionId: string,
  schedule: NormalizedSchedule,
  now: Date,
  instance: string,
): Promise<void> {
  const delivery = current
    ? {
        quotationId: current.quotationId,
        revisionId: current.revisionId,
        deliveryId: current.deliveryId,
        phone: await deliveryPhone(database, current.deliveryId),
        receiptAt: current.firstProviderReceiptAt,
      }
    : await eligibleNewCycleDelivery(database, opportunityId);
  if (!delivery) {
    throw new ActionConflictError(
      'Não há proposta entregue e identificada para iniciar um novo ciclo.',
    );
  }
  const identity = await verifiedFollowUpIdentity(
    database,
    instance,
    phoneDigits(current?.canonicalPhone) || phoneDigits(delivery.phone),
    String(current?.providerConversationId || delivery.phone).trim(),
  );
  const cycleResult = await database.execute(sql`
    SELECT ${nextFollowUpCycleNumber(sql`${opportunityId}::uuid`)} AS cycle_number
  `);
  const cycleRow = Array.from(cycleResult as Iterable<Record<string, unknown>>)[0];
  const cycleNumber = Number(cycleRow?.cycle_number || 1);
  if (!Number.isInteger(cycleNumber) || cycleNumber < 1) {
    throw new OpportunityActionRepositoryError();
  }
  const firstProviderReceiptAt = current?.firstProviderReceiptAt || delivery.receiptAt;
  if (current) {
    const [updated] = await database
      .update(quotationFollowUps)
      .set({
        revisionId: delivery.revisionId,
        deliveryId: delivery.deliveryId,
        cycleNumber,
        attemptNumber: 1,
        sourceActionId: successorActionId,
        instance: identity.instance,
        providerConversationId: identity.providerConversationId,
        canonicalPhone: identity.canonicalPhone,
        state: 'waiting',
        closedReason: null,
        approvedOpportunityId: null,
        leaseToken: null,
        leaseUntil: null,
        transportStartedAt: null,
        providerMessageId: null,
        firstProviderReceiptAt,
        dueAt: schedule.dueAt,
        eligibilityVersion: null,
        messageSnapshot: null,
        approvedAt: null,
        sentAt: null,
        closedAt: null,
        updatedAt: now,
      })
      .where(eq(quotationFollowUps.id, current.id))
      .returning({ id: quotationFollowUps.id });
    if (!updated) throw new ActionConflictError();
    return;
  }
  const [inserted] = await database
    .insert(quotationFollowUps)
    .values({
      id: randomUUID(),
      quotationId: delivery.quotationId,
      revisionId: delivery.revisionId,
      deliveryId: delivery.deliveryId,
      cycleNumber,
      attemptNumber: 1,
      sourceActionId: successorActionId,
      approvedOpportunityId: null,
      instance: identity.instance,
      providerConversationId: identity.providerConversationId,
      canonicalPhone: identity.canonicalPhone,
      eligibilityVersion: null,
      messageSnapshot: null,
      state: 'waiting',
      closedReason: null,
      leaseToken: null,
      leaseUntil: null,
      transportStartedAt: null,
      providerMessageId: null,
      firstProviderReceiptAt,
      dueAt: schedule.dueAt,
      approvedAt: null,
      sentAt: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: quotationFollowUps.id });
  if (!inserted) throw new ActionConflictError();
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

async function findFollowUpContinuityAction(
  database: ActionDatabase,
  commandId: string
): Promise<typeof opportunityNextActions.$inferSelect | null> {
  const [action] = await database
    .select()
    .from(opportunityNextActions)
    .where(eq(opportunityNextActions.continuityCommandId, commandId))
    .limit(1);
  return action || null;
}

async function replayFollowUpContinuity(
  database: ActionDatabase,
  successor: typeof opportunityNextActions.$inferSelect,
  fingerprint: string
): Promise<OpportunityActionCommandResult> {
  if (successor.continuityCommandFingerprint !== fingerprint) {
    throw new ActionConflictError('O ID do comando já foi usado com outra decisão.');
  }
  const [action] = await database
    .select()
    .from(opportunityNextActions)
    .where(eq(opportunityNextActions.replacedById, successor.id))
    .limit(1);
  const initialSuccessor = rowRecord({
    ...successor,
    state: 'active',
    version: successor.version,
    updatedAt: successor.createdAt,
    transitionActor: null,
    transitionAt: null,
    transitionOrigin: null,
    transitionReason: null,
    replacedById: null,
  });
  return {
    actionId: action?.id || successor.id,
    opportunityId: successor.opportunityId,
    state: action ? rowState(action.state) : 'completed',
    version: successor.version,
    action: action ? rowRecord(action) : null,
    successor: initialSuccessor,
    closed: false,
  };
}

function isFollowUpDecisionAction(action: typeof opportunityNextActions.$inferSelect): boolean {
  return action.reasonCode === FOLLOW_UP_DECISION_REASON_CODE;
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
              COALESCE(anchor.quotation_id, source_follow_up.quotation_id) AS source_quotation_id,
              COALESCE(anchor.revision_id, source_follow_up.revision_id) AS source_revision_id,
              COALESCE(anchor.delivery_id, source_follow_up.delivery_id) AS source_delivery_id,
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
            LEFT JOIN opportunity_delivery_anchors anchor ON anchor.created_action_id = a.id
            LEFT JOIN LATERAL (
              SELECT f.quotation_id, f.revision_id, f.delivery_id
              FROM quotation_follow_ups f
              WHERE f.source_action_id = a.id
              ORDER BY f.cycle_number DESC, f.attempt_number DESC, f.updated_at DESC
              LIMIT 1
            ) source_follow_up ON true
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
                sourceQuotationId: row.source_quotation_id,
                sourceRevisionId: row.source_revision_id,
                sourceDeliveryId: row.source_delivery_id,
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
    async associateInboundResponse(
      input: AssociateInboundResponseInput,
    ): Promise<OpportunityActionCommandResult> {
      const opportunityId = cleanText(input.opportunityId, 'O ID da oportunidade', 255);
      const actor = cleanText(input.actor, 'O operador', MAX_ACTOR_LENGTH);
      const expectedVersion = validateVersion(input.expectedVersion);
      try {
        return await getDb().transaction(async (tx) => {
          const [deal] = await tx
            .select({
              id: crmDeals.id,
              clientId: crmDeals.clientId,
              status: crmDeals.status,
            })
            .from(crmDeals)
            .where(eq(crmDeals.id, opportunityId))
            .limit(1);
          if (!deal) throw new ActionNotFoundError('Oportunidade não encontrada.');
          if (deal.status === 'Pedido Fechado' || deal.status === 'Perdido') {
            throw new OpportunityActionInputError(
              'Não é possível associar resposta a uma oportunidade encerrada.',
            );
          }
          if (!deal.clientId) {
            throw new OpportunityActionInputError(
              'A oportunidade não tem cliente para associar a resposta.',
            );
          }
          const active = await activeAction(tx, opportunityId);
          if (input.actionId) {
            const actionId = cleanText(input.actionId, 'O ID da ação', 255);
            const [alert] = await tx
              .select()
              .from(opportunityNextActions)
              .where(eq(opportunityNextActions.id, actionId))
              .limit(1);
            if (!alert || alert.state !== 'active') {
              throw new ActionNotFoundError('Alerta Associar resposta não encontrado.');
            }
            if (alert.reasonCode !== ASSOCIATE_RESPONSE_REASON_CODE) {
              throw new OpportunityActionInputError(
                'A ação informada não é um alerta Associar resposta.',
              );
            }
            if (alert.opportunityId === opportunityId && alert.version !== expectedVersion) {
              throw new ActionConflictError();
            }
          } else if (!active || active.version !== expectedVersion) {
            throw new ActionConflictError();
          }
          const now = nowFactory();
          return resolveAssociateResponseToOpportunity({
            database: tx,
            clientId: deal.clientId,
            opportunityId,
            occurredAt: now,
            idFactory,
            actor,
          });
        });
      } catch (error) {
        if (
          error instanceof OpportunityActionInputError ||
          error instanceof ActionNotFoundError ||
          error instanceof ActionConflictError
        ) {
          throw error;
        }
        throw new OpportunityActionRepositoryError();
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
          if (isFollowUpDecisionAction(active)) {
            throw new ActionConflictError(
              'A decisão de continuidade exige escolher novo ciclo ou data confirmada.'
            );
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
          if (isFollowUpDecisionAction(active)) {
            throw new ActionConflictError(
              'A decisão de continuidade exige escolher novo ciclo ou data confirmada.'
            );
          }
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

          if (isFollowUpDecisionAction(active)) {
            throw new ActionConflictError(
              'A decisão de continuidade exige escolher novo ciclo ou data confirmada.'
            );
          }

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
          if (isFollowUpDecisionAction(active)) {
            throw new ActionConflictError(
              'A decisão de continuidade exige escolher novo ciclo ou data confirmada.'
            );
          }
          if (normalized.countsAsFollowUp && deal.followUpStage >= 2) {
            throw new ActionConflictError(
              'O limite de dois retornos foi atingido. Registre uma decisão de continuidade.'
            );
          }

          const eventId = idFactory();
          const continuation = normalized.continuation;
          const current = await lockCurrentFollowUp(
            database,
            normalized.opportunityId,
            active.id,
            { rejectStartedTransport: normalized.countsAsFollowUp },
          );
          if (current?.state === 'processing' && current.transportStartedAt) {
            throw new ActionConflictError('O envio técnico já começou. Recarregue a fila.');
          }
          const silentCount =
            normalized.countsAsFollowUp && normalized.resultCode === 'no_response';
          const legacyFollowUpSchedule = normalized.countsAsFollowUp && !current
            ? followUpTransitionSchedule((deal.followUpStage + 1) as 1 | 2, now, 'manual')
            : null;
          const actionResult = silentCount && current
            ? await advanceConfirmedFollowUp({
                database,
                opportunityId: normalized.opportunityId,
                current,
                stage: deal.followUpStage,
                confirmedAt: now,
                source: 'manual',
                actor: normalized.actor,
                confirmationCommandId: normalized.commandId,
                activeAction: active,
                idFactory,
              })
            : legacyFollowUpSchedule
              ? await completeWithSuccessor(
                  database,
                  active,
                  legacyFollowUpSchedule,
                  normalized.actor,
                  'manual',
                  legacyFollowUpSchedule.reason,
                  now,
                  idFactory,
                )
            : continuation.schedule
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

          if (normalized.countsAsFollowUp && current && !silentCount) {
            await archiveManualFollowUpAttempt(database, {
              opportunityId: normalized.opportunityId,
              current,
              stage: deal.followUpStage,
              confirmedAt: now,
              commandId: normalized.commandId,
              successorActionId: actionResult.successor?.actionId,
              idFactory,
            });
          } else if (!normalized.countsAsFollowUp) {
            await closePendingTechnicalFollowUp(
              database,
              normalized.opportunityId,
              active.id,
              now,
            );
          }

          if (normalized.countsAsFollowUp && !current) {
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

    async continueFollowUp(input: ContinueFollowUpInput): Promise<OpportunityActionCommandResult> {
      const normalized = normalizeFollowUpContinuity(input);
      const fingerprint = followUpContinuityFingerprint(normalized);
      const now = nowDate(input.now, nowFactory);
      try {
        const existing = await findFollowUpContinuityAction(getDb(), normalized.commandId);
        if (existing) return replayFollowUpContinuity(getDb(), existing, fingerprint);

        return await getDb().transaction(async (database) => {
          const beforeLock = await findFollowUpContinuityAction(database, normalized.commandId);
          if (beforeLock) return replayFollowUpContinuity(database, beforeLock, fingerprint);

          const deal = await lockOpportunity(database, normalized.opportunityId);
          assertOpenOpportunity(deal.status);
          if (deal.followUpStage !== 2) {
            throw new ActionConflictError(
              'A decisão de continuidade só está disponível após o segundo retorno.'
            );
          }
          const active = await lockAction(database, normalized.actionId, normalized.opportunityId);
          assertExpectedAction(active, normalized.expectedVersion);
          if (!isFollowUpDecisionAction(active)) {
            throw new ActionConflictError('A ação atual não é uma decisão de continuidade.');
          }

          const current = await lockCurrentFollowUp(
            database,
            normalized.opportunityId,
            active.id,
            { rejectStartedTransport: true },
          );
          if (current?.state === 'processing' && current.transportStartedAt) {
            throw new ActionConflictError('O envio técnico já começou. Recarregue a fila.');
          }
          const successorSchedule =
            normalized.type === 'new_cycle'
              ? {
                  ...normalized.schedule,
                  kind: 'customer_contact' as const,
                  reasonCode: 'proposal_delivery_confirmed',
                  origin: 'event' as const,
                  reason: normalized.schedule.reason || 'Primeiro retorno do novo ciclo',
                }
              : normalized.schedule;

          const successorActionId = normalized.type === 'new_cycle' ? idFactory() : undefined;
          const successor = await completeWithSuccessor(
            database,
            active,
            successorSchedule,
            normalized.actor,
            normalized.type === 'new_cycle' ? 'event' : 'manual',
            normalized.type === 'new_cycle'
              ? 'Novo ciclo confirmado pelo operador'
              : 'Data de continuidade confirmada pelo operador',
            now,
            idFactory,
            { commandId: normalized.commandId, fingerprint, type: normalized.type },
            successorActionId,
          );
          if (normalized.type === 'new_cycle') {
            const [reset] = await database
              .update(crmDeals)
              .set({ followUpStage: 0, updatedAt: now })
              .where(and(eq(crmDeals.id, normalized.opportunityId), eq(crmDeals.followUpStage, 2)))
              .returning({ id: crmDeals.id });
            if (!reset) throw new ActionConflictError();

            const instance = String(process.env.EVOLUTION_INSTANCE || '').trim();
            if (!instance) {
              throw new ActionConflictError('A instância do WhatsApp não está configurada.');
            }
            await materializeNewCycleFollowUp(
              database,
              normalized.opportunityId,
              current,
              successor.successor!.actionId,
              successorSchedule,
              now,
              instance,
            );
          }
          return successor;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const winner = await findFollowUpContinuityAction(getDb(), normalized.commandId);
          if (winner) return replayFollowUpContinuity(getDb(), winner, fingerprint);
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
