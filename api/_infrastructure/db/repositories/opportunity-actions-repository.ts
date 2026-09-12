import { and, asc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { calendarDateInSaoPaulo } from '../../../_shared/calendar-sao-paulo.js';
import { getDatabase, type AppDatabase } from '../client.js';
import { crmDeals, opportunityNextActions } from '../schema.js';
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
export type OpportunityActionDueStatus = 'upcoming' | 'today' | 'overdue';

const ACTION_KINDS: readonly OpportunityActionKind[] = [
  'first_contact',
  'internal',
  'customer_contact',
  'agreed_commitment',
  'review',
];
const ACTION_ORIGINS: readonly OpportunityActionOrigin[] = ['manual', 'automatic', 'event'];
const CLOSED_OPPORTUNITY_STATUSES = ['Pedido Fechado', 'Perdido'] as const;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^\d{2}:\d{2}$/;
const MAX_REASON_LENGTH = 500;
const MAX_ACTOR_LENGTH = 128;

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

export type OpportunityActionHistoryType = 'created' | 'rescheduled' | 'completed' | 'replaced';

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

export interface OpportunityActionRepository {
  listActive(options?: OpportunityQueueListOptions): Promise<OpportunityQueuePage>;
  createAction(input: CreateOpportunityActionInput): Promise<OpportunityActionCommandResult>;
  rescheduleAction(input: RescheduleOpportunityActionInput): Promise<OpportunityActionCommandResult>;
  completeAction(input: CompleteOpportunityActionInput): Promise<OpportunityActionCommandResult>;
  listHistory(opportunityId: string): Promise<OpportunityActionHistoryEntry[]>;
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
    throw new OpportunityActionInputError(`${label} é obrigatório e deve ter no máximo ${maximum} caracteres.`);
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
  const reasonCode = cleanText(input.reasonCode || defaultReasonCode(kind), 'O código do motivo', 32);
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

function parseProposals(value: unknown): OpportunityProposal[] {
  if (!Array.isArray(value)) return [];
  const proposals: OpportunityProposal[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as ProposalJsonRow;
    if (typeof row.quotation_id !== 'string' || typeof row.business_number !== 'string') continue;
    const createdAt = row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at));
    proposals.push({
      quotationId: row.quotation_id,
      businessNumber: row.business_number,
      status: typeof row.status === 'string' ? row.status : 'rascunho',
      total: row.total === null || row.total === undefined ? null : String(row.total),
      createdAt: Number.isNaN(createdAt.getTime()) ? new Date(0).toISOString() : createdAt.toISOString(),
    });
  }
  return proposals;
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

function assertOpenOpportunity(status: string): void {
  if (CLOSED_OPPORTUNITY_STATUSES.includes(status as (typeof CLOSED_OPPORTUNITY_STATUSES)[number])) {
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
      const closedStatuses = [...CLOSED_OPPORTUNITY_STATUSES];
      const now = nowDate(undefined, nowFactory);

      try {
        const database = getDb();
        // One statement returns the consistent snapshot (total + clamped page)
        // and the page rows together. When a close or removal shrinks the queue
        // below the requested page, `page` is clamped to the last valid one.
        const rows = (await database.execute(sql`
          WITH filtered AS (
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
              d.demand_summary,
              d.nome AS contact_name,
              d.telefone AS contact_phone,
              d.email AS contact_email,
              d.client_id,
              c.nome AS client_name,
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
            WHERE a.state = 'active'
              AND d.status NOT IN (${sql.join(
                closedStatuses.map((status) => sql`${status}`),
                sql`, `
              )})
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
            ORDER BY due_at ASC, created_at ASC, action_id ASC
            LIMIT ${pageSize} OFFSET (position.page - 1) * ${pageSize}
          ) AS page_rows ON true
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
                dueStatus: dueStatus(scheduleType, dueDate, dueAt, now),
                version: Number(row.version || 1),
                actor: row.actor,
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

    async createAction(input: CreateOpportunityActionInput): Promise<OpportunityActionCommandResult> {
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
      const transitionOrigin = validateTransitionOrigin(input.transitionOrigin ?? successor?.origin);
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

    async listHistory(opportunityId: string): Promise<OpportunityActionHistoryEntry[]> {
      const normalizedId = cleanText(opportunityId, 'O ID da oportunidade', 255);
      try {
        const rows = await getDb()
          .select()
          .from(opportunityNextActions)
          .where(eq(opportunityNextActions.opportunityId, normalizedId))
          .orderBy(asc(opportunityNextActions.createdAt), asc(opportunityNextActions.id));
        const history: OpportunityActionHistoryEntry[] = [];
        const rowsById = new Map(rows.map((row) => [row.id, row]));
        const successorIds = new Set(
          rows.map((row) => row.replacedById).filter((id): id is string => Boolean(id))
        );
        const visited = new Set<string>();

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
