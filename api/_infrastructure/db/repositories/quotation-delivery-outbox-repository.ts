import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  lte,
  lt,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import {
  quoteRevisions,
  quotations,
  quotationDeliveries,
  quotationDeliverySteps,
} from '../schema.js';
import {
  aggregateDeliveryState,
  applyReceipt as applyDeliveryReceipt,
  failureTargetState,
  retryDelayMs,
  type DeliveryState,
  type DeliveryStepState,
  type EvolutionReceiptStatus,
  type TransportFailureKind,
} from '../../../_modules/quotation-delivery-state.js';
import { normalizeWhatsappPhone } from '../../../_modules/whatsapp-conversations-store.js';

type DatabaseProvider = () => AppDatabase;
type DeliveryDatabase = AppDatabase | Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

type CompletionSource = 'provider_receipt' | 'operator' | 'legacy_provider_ack';

type DeliveryRow = typeof quotationDeliveries.$inferSelect;
type DeliveryStepRow = typeof quotationDeliverySteps.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE = /^(?:\+?[0-9().\s-]+|[0-9]+@(s\.whatsapp\.net|c\.us))$/i;
const DELIVERY_STATES = [
  'queued',
  'processing',
  'provider_accepted',
  'reconciling',
  'retry_scheduled',
  'needs_review',
  'delivered',
  'failed',
] as const;
const RECEIPT_STATUSES = [
  'ERROR',
  'PENDING',
  'SERVER_ACK',
  'DELIVERY_ACK',
  'READ',
  'PLAYED',
] as const;
const FAILURE_KINDS = ['transient_pre_transport', 'permanent_pre_transport', 'ambiguous'] as const;
const COMPLETION_SOURCES = ['provider_receipt', 'operator', 'legacy_provider_ack'] as const;
const ACTIVE_STATES = [
  'queued',
  'processing',
  'provider_accepted',
  'reconciling',
  'retry_scheduled',
] as const;
const LEASE_MS = 90_000;
const RECONCILIATION_MS = 120_000;
const PROVIDER_DELAY_MS = 86_400_000;
const MAX_FLOW_ID = 120;
const MAX_FLOW_NAME = 255;
const MAX_NOTE = 500;
const MAX_PUBLIC_ERROR = 500;
const MAX_PROVIDER_MESSAGE_ID = 255;
const MAX_FAILURE_CODE = 120;
const MAX_SNAPSHOT_TEXT = 4_000;
const MAX_SNAPSHOT_URL = 2_000;
const MAX_SNAPSHOT_FILE_NAME = 255;
const MAX_STEPS = 100;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export class QuotationDeliveryOutboxInputError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'QuotationDeliveryOutboxInputError';
  }
}

export class QuotationDeliveryOutboxConflictError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = 'QuotationDeliveryOutboxConflictError';
  }
}

export class QuotationDeliveryOutboxNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message = 'Entrega não encontrada.') {
    super(message);
    this.name = 'QuotationDeliveryOutboxNotFoundError';
  }
}

export class QuotationDeliveryOutboxRepositoryError extends Error {
  readonly statusCode = 503;

  constructor(message = 'Não foi possível atualizar a entrega. Tente novamente.') {
    super(message);
    this.name = 'QuotationDeliveryOutboxRepositoryError';
  }
}

export interface DeliveryIdentity {
  revisionId: string;
  flowId: string;
}

export type FrozenDeliveryStep =
  | { position: number; type: 'text'; payload: { text: string }; delayMs: number }
  | {
      position: number;
      type: 'media';
      payload: { mediaType: 'image' | 'document'; url: string; fileName: string; caption: string };
      delayMs: number;
    }
  | {
      position: number;
      type: 'quotation_pdf';
      payload: { revisionId: string; fileName: string; caption: string };
      delayMs: number;
    };

export interface DeliveryStepView {
  id: string;
  position: number;
  type: FrozenDeliveryStep['type'];
  state: DeliveryStepState;
  attemptCount: number;
  publicError: string | null;
  nextAttemptAt: Date | null;
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  updatedAt: Date;
}

export interface EnqueueDeliveryRecord extends DeliveryIdentity {
  phone: string;
  flowName: string;
  steps: FrozenDeliveryStep[];
}

export interface DeliveryListFilters {
  states?: DeliveryState[];
  search?: string;
  from?: Date;
  to?: Date;
  requiresAction?: boolean;
  includeActive?: boolean;
  delayed?: boolean;
  page: number;
  pageSize: number;
}

export interface DeliveryAggregate {
  id: string;
  revisionId: string;
  businessNumber: string;
  clientName: string;
  phone: string;
  flowId: string;
  flowName: string;
  state: DeliveryState;
  completionSource: CompletionSource | null;
  publicError: string | null;
  nextAttemptAt: Date | null;
  actionDeadline: Date | null;
  reconciliationDeadline: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  steps: DeliveryStepView[];
}

export interface DeliveryListResult {
  data: DeliveryAggregate[];
  total: number;
  summary: {
    active: number;
    requiresAction: number;
    retryScheduled: number;
    delayed: number;
    deliveredLast24Hours: number;
  };
}

export interface ClaimedDeliveryStep {
  delivery: DeliveryAggregate;
  step: DeliveryStepView & { snapshot: FrozenDeliveryStep };
  leaseToken: string;
}

export interface MarkAcceptedInput {
  deliveryId: string;
  stepId: string;
  leaseToken: string;
  providerMessageId: string;
}

export interface MarkFailureInput {
  deliveryId: string;
  stepId: string;
  leaseToken: string;
  kind: TransportFailureKind;
  code: string;
  publicError: string;
}

export interface ApplyReceiptInput {
  providerMessageId: string;
  status: EvolutionReceiptStatus;
}

export type ResolveDeliveryInput =
  | {
      deliveryId: string;
      decision: 'confirmed_received';
      note: string;
      resolvedBy: 'authenticated-operator';
    }
  | {
      deliveryId: string;
      decision: 'confirmed_not_received';
      note: string;
      resolvedBy: 'authenticated-operator';
    };

export interface QuotationDeliveryOutboxRepository {
  enqueue(input: EnqueueDeliveryRecord): Promise<DeliveryAggregate>;
  get(deliveryId: string): Promise<DeliveryAggregate | null>;
  getByIdentity(identity: DeliveryIdentity): Promise<DeliveryAggregate | null>;
  list(filters: DeliveryListFilters): Promise<DeliveryListResult>;
  claim(input?: { deliveryId?: string }): Promise<ClaimedDeliveryStep | null>;
  markAccepted(input: MarkAcceptedInput): Promise<DeliveryAggregate>;
  markFailure(input: MarkFailureInput): Promise<DeliveryAggregate>;
  applyReceipt(input: ApplyReceiptInput): Promise<DeliveryAggregate | null>;
  expireReconciliations(limit: number): Promise<number>;
  cancelPending(): Promise<number>;
  resolve(input: ResolveDeliveryInput): Promise<DeliveryAggregate>;
}

export interface QuotationDeliveryOutboxRepositoryOptions {
  now?: () => Date;
  leaseMs?: number;
  reconciliationMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripControls(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join('');
}

function text(
  value: unknown,
  label: string,
  maximum: number,
  options: { min?: number } = {}
): string {
  if (typeof value !== 'string') throw new QuotationDeliveryOutboxInputError(`${label} inválido.`);
  const result = value.trim();
  if (
    result.length < (options.min ?? 1) ||
    result.length > maximum ||
    stripControls(result) !== result
  ) {
    throw new QuotationDeliveryOutboxInputError(`${label} inválido.`);
  }
  return result;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value.trim())) {
    throw new QuotationDeliveryOutboxInputError(`${label} inválido.`);
  }
  return value.trim();
}

function normalizePhone(value: unknown): string {
  if (typeof value !== 'string' || !PHONE.test(value.trim())) {
    throw new QuotationDeliveryOutboxInputError('Telefone do destinatário inválido.');
  }
  const result = normalizeWhatsappPhone(value);
  if (!/^\d{10,15}$/.test(result)) {
    throw new QuotationDeliveryOutboxInputError('Telefone do destinatário inválido.');
  }
  return result;
}

function validDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new QuotationDeliveryOutboxInputError(`${label} inválida.`);
  }
  return new Date(value.getTime());
}

function nowFrom(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new QuotationDeliveryOutboxRepositoryError();
  }
  return new Date(value.getTime());
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function normalizeSnapshot(value: unknown): FrozenDeliveryStep {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['position', 'type', 'payload', 'delayMs']) ||
    !Number.isInteger(value.position) ||
    (value.position as number) < 0
  ) {
    throw new QuotationDeliveryOutboxInputError('Snapshot de entrega inválido.');
  }
  const position = value.position as number;
  const delayMs = value.delayMs;
  if (!Number.isInteger(delayMs) || (delayMs as number) < 0 || (delayMs as number) > 86_400_000) {
    throw new QuotationDeliveryOutboxInputError('Snapshot de entrega inválido.');
  }
  if (value.type === 'text') {
    if (!isRecord(value.payload) || !exactKeys(value.payload, ['text']))
      throw new QuotationDeliveryOutboxInputError('Snapshot de entrega inválido.');
    return {
      position,
      type: 'text',
      payload: { text: text(value.payload.text, 'Texto do passo', MAX_SNAPSHOT_TEXT, { min: 0 }) },
      delayMs: delayMs as number,
    };
  }
  if (value.type === 'media') {
    if (
      !isRecord(value.payload) ||
      !exactKeys(value.payload, ['mediaType', 'url', 'fileName', 'caption']) ||
      (value.payload.mediaType !== 'image' && value.payload.mediaType !== 'document')
    ) {
      throw new QuotationDeliveryOutboxInputError('Snapshot de entrega inválido.');
    }
    return {
      position,
      type: 'media',
      payload: {
        mediaType: value.payload.mediaType,
        url: text(value.payload.url, 'URL do passo', MAX_SNAPSHOT_URL),
        fileName: text(value.payload.fileName, 'Nome do arquivo', MAX_SNAPSHOT_FILE_NAME),
        caption: text(value.payload.caption, 'Legenda do passo', MAX_SNAPSHOT_TEXT, { min: 0 }),
      },
      delayMs: delayMs as number,
    };
  }
  if (value.type === 'quotation_pdf') {
    if (
      !isRecord(value.payload) ||
      !exactKeys(value.payload, ['revisionId', 'fileName', 'caption'])
    )
      throw new QuotationDeliveryOutboxInputError('Snapshot de entrega inválido.');
    return {
      position,
      type: 'quotation_pdf',
      payload: {
        revisionId: uuid(value.payload.revisionId, 'Identificador da revisão'),
        fileName: text(value.payload.fileName, 'Nome do arquivo', MAX_SNAPSHOT_FILE_NAME),
        caption: text(value.payload.caption, 'Legenda do passo', MAX_SNAPSHOT_TEXT, { min: 0 }),
      },
      delayMs: delayMs as number,
    };
  }
  throw new QuotationDeliveryOutboxInputError('Snapshot de entrega inválido.');
}

function normalizeSnapshots(value: unknown): FrozenDeliveryStep[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STEPS) {
    throw new QuotationDeliveryOutboxInputError('Passos da entrega inválidos.');
  }
  const result = value.map(normalizeSnapshot).sort((a, b) => a.position - b.position);
  if (result.some((step, index) => index > 0 && step.position === result[index - 1]!.position)) {
    throw new QuotationDeliveryOutboxInputError('Posições dos passos inválidas.');
  }
  return result;
}

function normalizeIdentity(input: DeliveryIdentity): DeliveryIdentity {
  return {
    revisionId: uuid(input?.revisionId, 'Identificador da revisão'),
    flowId: text(input?.flowId, 'Fluxo', MAX_FLOW_ID),
  };
}

function normalizeEnqueue(input: EnqueueDeliveryRecord): EnqueueDeliveryRecord {
  if (!isRecord(input)) throw new QuotationDeliveryOutboxInputError('Entrega inválida.');
  const identity = normalizeIdentity(input as DeliveryIdentity);
  return {
    ...identity,
    phone: normalizePhone(input.phone),
    flowName: text(input.flowName, 'Nome do fluxo', MAX_FLOW_NAME),
    steps: normalizeSnapshots(input.steps),
  };
}

function normalizeProviderMessageId(value: unknown): string {
  return text(value, 'Identificador da mensagem', MAX_PROVIDER_MESSAGE_ID);
}

function normalizeFailureKind(value: unknown): TransportFailureKind {
  if (!FAILURE_KINDS.includes(value as TransportFailureKind)) {
    throw new QuotationDeliveryOutboxInputError('Tipo de falha inválido.');
  }
  return value as TransportFailureKind;
}

function normalizeReceiptStatus(value: unknown): EvolutionReceiptStatus {
  if (!RECEIPT_STATUSES.includes(value as EvolutionReceiptStatus)) {
    throw new QuotationDeliveryOutboxInputError('Status de recibo inválido.');
  }
  return value as EvolutionReceiptStatus;
}

function normalizePublicError(value: unknown): string {
  return text(value, 'Erro público', MAX_PUBLIC_ERROR);
}

function normalizeFailureCode(value: unknown): string {
  return text(value, 'Código da falha', MAX_FAILURE_CODE);
}

function normalizePage(value: unknown, label: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 1_000_000) {
    throw new QuotationDeliveryOutboxInputError(`${label} inválida.`);
  }
  return value as number;
}

function normalizeFilters(
  input: DeliveryListFilters
): Required<Pick<DeliveryListFilters, 'page' | 'pageSize'>> &
  Omit<DeliveryListFilters, 'page' | 'pageSize'> {
  if (!isRecord(input)) throw new QuotationDeliveryOutboxInputError('Filtros inválidos.');
  const page = normalizePage(input.page, 'Página', 1);
  const pageSize = normalizePage(input.pageSize, 'Tamanho da página', DEFAULT_PAGE_SIZE);
  if (pageSize > MAX_PAGE_SIZE)
    throw new QuotationDeliveryOutboxInputError('Tamanho máximo da página é 100.');
  if (input.states !== undefined) {
    if (
      !Array.isArray(input.states) ||
      input.states.length === 0 ||
      input.states.some((state) => !DELIVERY_STATES.includes(state as DeliveryState))
    ) {
      throw new QuotationDeliveryOutboxInputError('Estados de entrega inválidos.');
    }
  }
  let search: string | undefined;
  if (input.search !== undefined) search = text(input.search, 'Busca', MAX_FLOW_NAME, { min: 0 });
  const from = input.from === undefined ? undefined : validDate(input.from, 'Data inicial');
  const to = input.to === undefined ? undefined : validDate(input.to, 'Data final');
  if (from && to && from > to) throw new QuotationDeliveryOutboxInputError('Período inválido.');
  if (input.requiresAction !== undefined && typeof input.requiresAction !== 'boolean') {
    throw new QuotationDeliveryOutboxInputError('Filtro de ação inválido.');
  }
  if (input.includeActive !== undefined && typeof input.includeActive !== 'boolean') {
    throw new QuotationDeliveryOutboxInputError('Filtro de atividade inválido.');
  }
  if (input.delayed !== undefined && typeof input.delayed !== 'boolean') {
    throw new QuotationDeliveryOutboxInputError('Filtro de atraso inválido.');
  }
  return {
    states: input.states,
    search,
    from,
    to,
    requiresAction: input.requiresAction,
    includeActive: input.includeActive,
    delayed: input.delayed,
    page,
    pageSize,
  };
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const result = value instanceof Date ? value : new Date(value);
  return Number.isNaN(result.getTime()) ? null : new Date(result.getTime());
}

function requiredDate(value: Date | string | null | undefined, fallback: Date): Date {
  return asDate(value) || new Date(fallback.getTime());
}

function safeStoredError(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const result = stripControls(value).trim().slice(0, MAX_PUBLIC_ERROR);
  return result || null;
}

function safeCompletionSource(value: unknown): CompletionSource | null {
  return COMPLETION_SOURCES.includes(value as CompletionSource)
    ? (value as CompletionSource)
    : null;
}

function countValue(value: unknown): number {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

function isUniqueViolation(error: unknown): boolean {
  return isRecord(error) && error.code === '23505';
}

function knownError(error: unknown): boolean {
  return (
    error instanceof QuotationDeliveryOutboxInputError ||
    error instanceof QuotationDeliveryOutboxConflictError ||
    error instanceof QuotationDeliveryOutboxNotFoundError ||
    error instanceof QuotationDeliveryOutboxRepositoryError
  );
}

function rethrowRepositoryError(error: unknown): never {
  if (knownError(error)) throw error;
  if (isUniqueViolation(error)) {
    throw new QuotationDeliveryOutboxConflictError(
      'A mensagem do provedor já está associada a outra etapa.'
    );
  }
  throw new QuotationDeliveryOutboxRepositoryError();
}

function buildStepView(row: DeliveryStepRow, now: Date): DeliveryStepView {
  return {
    id: row.id,
    position: row.position,
    type: row.type as FrozenDeliveryStep['type'],
    state: row.state as DeliveryStepState,
    attemptCount: row.attemptCount,
    publicError: safeStoredError(row.publicError),
    nextAttemptAt: asDate(row.nextAttemptAt),
    acceptedAt: asDate(row.acceptedAt),
    deliveredAt: asDate(row.deliveredAt),
    readAt: asDate(row.readAt),
    updatedAt: requiredDate(row.updatedAt, now),
  };
}

function stepSnapshot(row: DeliveryStepRow): FrozenDeliveryStep {
  const payload = isRecord(row.payloadSnapshot) ? { ...row.payloadSnapshot } : {};
  const delayMs = typeof payload.delayMs === 'number' ? payload.delayMs : 0;
  delete payload.delayMs;
  return normalizeSnapshot({
    position: row.position,
    type: row.type,
    payload,
    delayMs,
  });
}

async function readAggregate(
  db: DeliveryDatabase,
  deliveryId: string,
  now: Date
): Promise<DeliveryAggregate | null> {
  const [row] = await db
    .select({
      id: quotationDeliveries.id,
      revisionId: quotationDeliveries.revisionId,
      businessNumber: quotations.businessNumber,
      clientName: quoteRevisions.clienteNome,
      phone: quotationDeliveries.phone,
      flowId: quotationDeliveries.flowId,
      flowName: quotationDeliveries.flowName,
      state: quotationDeliveries.state,
      completionSource: quotationDeliveries.completionSource,
      publicError: quotationDeliveries.publicError,
      nextAttemptAt: quotationDeliveries.nextAttemptAt,
      reconciliationDeadline: quotationDeliveries.reconciliationDeadline,
      deliveredAt: quotationDeliveries.deliveredAt,
      createdAt: quotationDeliveries.createdAt,
      updatedAt: quotationDeliveries.updatedAt,
    })
    .from(quotationDeliveries)
    .innerJoin(quoteRevisions, eq(quoteRevisions.id, quotationDeliveries.revisionId))
    .innerJoin(quotations, eq(quotations.id, quoteRevisions.quotationId))
    .where(eq(quotationDeliveries.id, deliveryId))
    .limit(1);
  if (!row) return null;
  const steps = await db
    .select()
    .from(quotationDeliverySteps)
    .where(eq(quotationDeliverySteps.deliveryId, deliveryId))
    .orderBy(asc(quotationDeliverySteps.position), asc(quotationDeliverySteps.id));
  const updatedAt = requiredDate(row.updatedAt, now);
  const state = row.state as DeliveryState;
  return {
    id: row.id,
    revisionId: row.revisionId,
    businessNumber: row.businessNumber,
    clientName: row.clientName,
    phone: row.phone,
    flowId: row.flowId,
    flowName: row.flowName,
    state,
    completionSource: safeCompletionSource(row.completionSource),
    publicError: safeStoredError(row.publicError),
    nextAttemptAt: asDate(row.nextAttemptAt),
    actionDeadline:
      state === 'provider_accepted'
        ? new Date(updatedAt.getTime() + PROVIDER_DELAY_MS)
        : null,
    reconciliationDeadline: asDate(row.reconciliationDeadline),
    deliveredAt: asDate(row.deliveredAt),
    createdAt: requiredDate(row.createdAt, now),
    updatedAt,
    steps: steps.map((step) => buildStepView(step, now)),
  };
}

async function lockDelivery(db: DeliveryDatabase, deliveryId: string): Promise<DeliveryRow | null> {
  await db.execute(sql`
    SELECT id
    FROM quotation_deliveries
    WHERE id = ${deliveryId}::uuid
    FOR UPDATE
  `);
  const [row] = await db
    .select()
    .from(quotationDeliveries)
    .where(eq(quotationDeliveries.id, deliveryId))
    .limit(1);
  return row || null;
}

async function syncDeliveryState(
  db: DeliveryDatabase,
  deliveryId: string,
  now: Date,
  completionSourceOverride?: CompletionSource | null,
  stateOverride?: DeliveryState
): Promise<void> {
  const [delivery] = await db
    .select()
    .from(quotationDeliveries)
    .where(eq(quotationDeliveries.id, deliveryId))
    .limit(1);
  if (!delivery) throw new QuotationDeliveryOutboxNotFoundError();
  const steps = await db
    .select()
    .from(quotationDeliverySteps)
    .where(eq(quotationDeliverySteps.deliveryId, deliveryId));
  const state =
    stateOverride ||
    (steps.length > 0
      ? aggregateDeliveryState(steps.map((step) => step.state as DeliveryStepState))
      : (delivery.state as DeliveryState));
  const nextAttemptAt =
    steps
      .filter(
        (step) =>
          (step.state === 'queued' || step.state === 'retry_scheduled') && step.nextAttemptAt
      )
      .map((step) => asDate(step.nextAttemptAt)!)
      .sort((a, b) => a.getTime() - b.getTime())[0] || null;
  const reconciliationDeadline =
    steps
      .filter((step) => step.state === 'reconciling' && step.reconciliationDeadline)
      .map((step) => asDate(step.reconciliationDeadline)!)
      .sort((a, b) => a.getTime() - b.getTime())[0] || null;
  const completionSource =
    completionSourceOverride !== undefined
      ? completionSourceOverride
      : state === 'delivered'
        ? safeCompletionSource(delivery.completionSource) || 'provider_receipt'
        : null;
  const deliveredAt =
    state === 'delivered' ? asDate(delivery.deliveredAt) || new Date(now.getTime()) : null;
  await db
    .update(quotationDeliveries)
    .set({
      state,
      nextAttemptAt,
      reconciliationDeadline,
      completionSource,
      deliveredAt,
      publicError: state === 'delivered' ? null : delivery.publicError,
      updatedAt: now,
    })
    .where(eq(quotationDeliveries.id, deliveryId));
}

function stepUpdateCondition(deliveryId: string, stepId: string, leaseToken: string): SQL {
  return sql`
    s.id = ${stepId}::uuid
    AND s.delivery_id = ${deliveryId}::uuid
    AND s.state = 'sending'
    AND EXISTS (
      SELECT 1
      FROM quotation_deliveries d
      WHERE d.id = s.delivery_id
        AND d.lease_token = ${leaseToken}::uuid
    )
  `;
}

function leaseUntil(now: Date, duration: number): Date {
  return new Date(now.getTime() + duration);
}

function listWhere(filters: ReturnType<typeof normalizeFilters>, now: Date): SQL | undefined {
  const conditions: SQL[] = [];
  if (filters.states?.length) conditions.push(inArray(quotationDeliveries.state, filters.states));
  if (filters.search !== undefined && filters.search !== '') {
    const pattern = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(quotations.businessNumber, pattern),
        ilike(quoteRevisions.clienteNome, pattern),
        ilike(quotationDeliveries.phone, pattern),
        ilike(quotationDeliveries.flowId, pattern),
        ilike(quotationDeliveries.flowName, pattern)
      )!
    );
  }
  if (filters.from) conditions.push(gte(quotationDeliveries.createdAt, filters.from));
  if (filters.to) conditions.push(lte(quotationDeliveries.createdAt, filters.to));
  const statusAlternatives: SQL[] = [];
  if (filters.requiresAction === true)
    statusAlternatives.push(eq(quotationDeliveries.state, 'needs_review'));
  if (filters.includeActive === true)
    statusAlternatives.push(inArray(quotationDeliveries.state, ACTIVE_STATES));
  if (statusAlternatives.length) conditions.push(or(...statusAlternatives)!);
  if (filters.delayed === true) {
    conditions.push(eq(quotationDeliveries.state, 'provider_accepted'));
    conditions.push(
      lte(quotationDeliveries.updatedAt, new Date(now.getTime() - PROVIDER_DELAY_MS))
    );
  }
  return conditions.length ? and(...conditions) : undefined;
}

async function filteredRows(
  db: DeliveryDatabase,
  filters: ReturnType<typeof normalizeFilters>,
  now: Date
): Promise<{ ids: string[]; total: number }> {
  const where = listWhere(filters, now);
  const totalRows = await db
    .select({ total: sql<number>`count(*)` })
    .from(quotationDeliveries)
    .innerJoin(quoteRevisions, eq(quoteRevisions.id, quotationDeliveries.revisionId))
    .innerJoin(quotations, eq(quotations.id, quoteRevisions.quotationId))
    .where(where);
  const rows = await db
    .select({ id: quotationDeliveries.id })
    .from(quotationDeliveries)
    .innerJoin(quoteRevisions, eq(quoteRevisions.id, quotationDeliveries.revisionId))
    .innerJoin(quotations, eq(quotations.id, quoteRevisions.quotationId))
    .where(where)
    .orderBy(desc(quotationDeliveries.createdAt), desc(quotationDeliveries.id))
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);
  return { ids: rows.map((row) => row.id), total: countValue(totalRows[0]?.total) };
}

async function summary(db: DeliveryDatabase, now: Date): Promise<DeliveryListResult['summary']> {
  const delayedAt = new Date(now.getTime() - PROVIDER_DELAY_MS).toISOString();
  const [row] = await db
    .select({
      active: sql<number>`count(*) FILTER (WHERE ${quotationDeliveries.state} IN ('queued', 'processing', 'provider_accepted', 'reconciling', 'retry_scheduled'))`,
      requiresAction: sql<number>`count(*) FILTER (WHERE ${quotationDeliveries.state} = 'needs_review')`,
      retryScheduled: sql<number>`count(*) FILTER (WHERE ${quotationDeliveries.state} = 'retry_scheduled')`,
      delayed: sql<number>`count(*) FILTER (WHERE ${quotationDeliveries.state} = 'provider_accepted' AND ${quotationDeliveries.updatedAt} <= ${delayedAt})`,
      deliveredLast24Hours: sql<number>`count(*) FILTER (WHERE ${quotationDeliveries.state} = 'delivered' AND ${quotationDeliveries.deliveredAt} >= ${delayedAt})`,
    })
    .from(quotationDeliveries);
  return {
    active: countValue(row?.active),
    requiresAction: countValue(row?.requiresAction),
    retryScheduled: countValue(row?.retryScheduled),
    delayed: countValue(row?.delayed),
    deliveredLast24Hours: countValue(row?.deliveredLast24Hours),
  };
}

export function createPostgresQuotationDeliveryOutboxRepository(
  getDb: DatabaseProvider = getDatabase,
  options: QuotationDeliveryOutboxRepositoryOptions = {}
): QuotationDeliveryOutboxRepository {
  const clock = options.now || (() => new Date());
  const configuredLeaseMs = options.leaseMs === undefined ? LEASE_MS : options.leaseMs;
  const configuredReconciliationMs =
    options.reconciliationMs === undefined ? RECONCILIATION_MS : options.reconciliationMs;
  if (
    !Number.isInteger(configuredLeaseMs) ||
    configuredLeaseMs < 1 ||
    configuredLeaseMs > 300_000
  ) {
    throw new QuotationDeliveryOutboxInputError('Lease inválido.');
  }
  if (
    !Number.isInteger(configuredReconciliationMs) ||
    configuredReconciliationMs < 1 ||
    configuredReconciliationMs > 86_400_000
  ) {
    throw new QuotationDeliveryOutboxInputError('Prazo de reconciliação inválido.');
  }

  async function enqueue(input: EnqueueDeliveryRecord): Promise<DeliveryAggregate> {
    const normalized = normalizeEnqueue(input);
    const now = nowFrom(clock);
    try {
      const db = getDb();
      return await db.transaction(async (tx) => {
        const deliveryId = randomUUID();
        const [inserted] = await tx
          .insert(quotationDeliveries)
          .values({
            id: deliveryId,
            revisionId: normalized.revisionId,
            phone: normalized.phone,
            flowId: normalized.flowId,
            flowName: normalized.flowName,
            state: 'queued',
            nextAttemptAt: new Date(now.getTime() + normalized.steps[0]!.delayMs),
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [quotationDeliveries.revisionId, quotationDeliveries.flowId],
          })
          .returning();
        const delivery =
          inserted ||
          (
            await tx
              .select()
              .from(quotationDeliveries)
              .where(
                and(
                  eq(quotationDeliveries.revisionId, normalized.revisionId),
                  eq(quotationDeliveries.flowId, normalized.flowId)
                )
              )
              .limit(1)
          )[0];
        if (!delivery) throw new QuotationDeliveryOutboxRepositoryError();
        if (inserted) {
          await tx.insert(quotationDeliverySteps).values(
            normalized.steps.map((step, index) => ({
              id: randomUUID(),
              deliveryId,
              position: step.position,
              type: step.type,
              payloadSnapshot: { ...step.payload, delayMs: step.delayMs },
              state: 'queued',
              attemptCount: 0,
              nextAttemptAt: index === 0 ? new Date(now.getTime() + step.delayMs) : null,
              createdAt: now,
              updatedAt: now,
            }))
          );
        }
        const aggregate = await readAggregate(tx, delivery.id, now);
        if (!aggregate) throw new QuotationDeliveryOutboxRepositoryError();
        return aggregate;
      });
    } catch (error) {
      return rethrowRepositoryError(error);
    }
  }

  async function get(deliveryId: string): Promise<DeliveryAggregate | null> {
    const id = uuid(deliveryId, 'Identificador da entrega');
    const now = nowFrom(clock);
    try {
      return await readAggregate(getDb(), id, now);
    } catch (error) {
      return rethrowRepositoryError(error);
    }
  }

  async function getByIdentity(identity: DeliveryIdentity): Promise<DeliveryAggregate | null> {
    const normalized = normalizeIdentity(identity);
    const now = nowFrom(clock);
    try {
      const db = getDb();
      const [row] = await db
        .select({ id: quotationDeliveries.id })
        .from(quotationDeliveries)
        .where(
          and(
            eq(quotationDeliveries.revisionId, normalized.revisionId),
            eq(quotationDeliveries.flowId, normalized.flowId)
          )
        )
        .limit(1);
      return row ? readAggregate(db, row.id, now) : null;
    } catch (error) {
      return rethrowRepositoryError(error);
    }
  }

  async function list(input: DeliveryListFilters): Promise<DeliveryListResult> {
    const filters = normalizeFilters(input);
    const now = nowFrom(clock);
    try {
      const db = getDb();
      const [{ ids, total }, resultSummary] = await Promise.all([
        filteredRows(db, filters, now),
        summary(db, now),
      ]);
      const data: DeliveryAggregate[] = [];
      for (const id of ids) {
        const aggregate = await readAggregate(db, id, now);
        if (aggregate) data.push(aggregate);
      }
      return { data, total, summary: resultSummary };
    } catch (error) {
      return rethrowRepositoryError(error);
    }
  }

  async function claim(input: { deliveryId?: string } = {}): Promise<ClaimedDeliveryStep | null> {
    const requestedId =
      input.deliveryId === undefined ? null : uuid(input.deliveryId, 'Identificador da entrega');
    const now = nowFrom(clock);
    try {
      const db = getDb();
      return await db.transaction(async (tx) => {
        const nowIso = now.toISOString();
        const recovered = (await tx.execute(sql`
          UPDATE quotation_delivery_steps s
          SET state = 'reconciling',
              next_attempt_at = NULL,
              reconciliation_deadline = ${new Date(now.getTime() + configuredReconciliationMs).toISOString()},
              updated_at = ${nowIso}
          WHERE s.state = 'sending'
            AND s.provider_message_id IS NULL
            AND EXISTS (
              SELECT 1
              FROM quotation_deliveries d
              WHERE d.id = s.delivery_id
                AND d.lease_until IS NOT NULL
                AND d.lease_until <= ${nowIso}
                AND (${requestedId}::uuid IS NULL OR d.id = ${requestedId}::uuid)
            )
          RETURNING s.delivery_id
        `)) as Array<{ delivery_id: string }>;
        for (const deliveryId of [...new Set(recovered.map((row) => row.delivery_id))]) {
          await tx
            .update(quotationDeliveries)
            .set({
              leaseToken: null,
              leaseUntil: null,
            })
            .where(eq(quotationDeliveries.id, deliveryId));
          await syncDeliveryState(tx, deliveryId, now);
        }
        const rows = (await tx.execute(sql`
          SELECT s.id, s.delivery_id
          FROM quotation_delivery_steps s
          JOIN quotation_deliveries d ON d.id = s.delivery_id
          WHERE s.state IN ('queued', 'retry_scheduled')
            AND s.next_attempt_at IS NOT NULL
            AND s.next_attempt_at <= ${nowIso}
            AND (d.lease_until IS NULL OR d.lease_until <= ${nowIso})
            AND (${requestedId}::uuid IS NULL OR d.id = ${requestedId}::uuid)
            AND NOT EXISTS (
              SELECT 1
              FROM quotation_delivery_steps prior
              WHERE prior.delivery_id = s.delivery_id
                AND prior.position < s.position
                AND (
                  prior.state NOT IN ('server_ack', 'delivered', 'read')
                  OR prior.provider_message_id IS NULL
                )
            )
          ORDER BY s.next_attempt_at, s.position
          FOR UPDATE OF d, s SKIP LOCKED
          LIMIT 1
        `)) as Array<{ id: string; delivery_id: string }>;
        const selected = rows[0];
        if (!selected) return null;
        const token = randomUUID();
        const until = leaseUntil(now, configuredLeaseMs);
        const [updatedDelivery] = await tx
          .update(quotationDeliveries)
          .set({
            leaseToken: token,
            leaseUntil: until,
            state: 'processing',
            updatedAt: now,
            attemptCount: sql`${quotationDeliveries.attemptCount} + 1`,
          })
          .where(eq(quotationDeliveries.id, selected.delivery_id))
          .returning();
        if (!updatedDelivery) throw new QuotationDeliveryOutboxRepositoryError();
        const [updatedStep] = await tx
          .update(quotationDeliverySteps)
          .set({
            state: 'sending',
            attemptCount: sql`${quotationDeliverySteps.attemptCount} + 1`,
            nextAttemptAt: null,
            reconciliationDeadline: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(quotationDeliverySteps.id, selected.id),
              eq(quotationDeliverySteps.deliveryId, selected.delivery_id),
              inArray(quotationDeliverySteps.state, ['queued', 'retry_scheduled'])
            )
          )
          .returning();
        if (!updatedStep) throw new QuotationDeliveryOutboxRepositoryError();
        await syncDeliveryState(tx, selected.delivery_id, now);
        const delivery = await readAggregate(tx, selected.delivery_id, now);
        if (!delivery) throw new QuotationDeliveryOutboxRepositoryError();
        const claimedStep = delivery.steps.find((step) => step.id === selected.id);
        if (!claimedStep) throw new QuotationDeliveryOutboxRepositoryError();
        const [rawStep] = await tx
          .select()
          .from(quotationDeliverySteps)
          .where(eq(quotationDeliverySteps.id, selected.id))
          .limit(1);
        if (!rawStep) throw new QuotationDeliveryOutboxRepositoryError();
        return {
          delivery,
          step: { ...claimedStep, snapshot: stepSnapshot(rawStep) },
          leaseToken: token,
        };
      });
    } catch (error) {
      return rethrowRepositoryError(error);
    }
  }

  async function markAccepted(input: MarkAcceptedInput): Promise<DeliveryAggregate> {
    const deliveryId = uuid(input?.deliveryId, 'Identificador da entrega');
    const stepId = uuid(input?.stepId, 'Identificador do passo');
    const token = uuid(input?.leaseToken, 'Lease');
    const providerMessageId = normalizeProviderMessageId(input?.providerMessageId);
    const now = nowFrom(clock);
    try {
      const db = getDb();
      return await db.transaction(async (tx) => {
        const nowIso = now.toISOString();
        const delivery = await lockDelivery(tx, deliveryId);
        if (!delivery || delivery.leaseToken !== token) {
          throw new QuotationDeliveryOutboxConflictError('O lease da etapa expirou ou é inválido.');
        }
        const [step] = await tx
          .select()
          .from(quotationDeliverySteps)
          .where(
            and(
              eq(quotationDeliverySteps.id, stepId),
              eq(quotationDeliverySteps.deliveryId, deliveryId)
            )
          )
          .limit(1);
        if (!step || step.state !== 'sending') {
          throw new QuotationDeliveryOutboxConflictError(
            'A etapa não está disponível para confirmação.'
          );
        }
        const predecessors = await tx
          .select({
            state: quotationDeliverySteps.state,
            providerMessageId: quotationDeliverySteps.providerMessageId,
          })
          .from(quotationDeliverySteps)
          .where(
            and(
              eq(quotationDeliverySteps.deliveryId, deliveryId),
              lt(quotationDeliverySteps.position, step.position)
            )
          );
        if (
          predecessors.some(
            (predecessor) =>
              !['server_ack', 'delivered', 'read'].includes(predecessor.state) ||
              !predecessor.providerMessageId
          )
        ) {
          throw new QuotationDeliveryOutboxConflictError(
            'As etapas anteriores ainda não foram aceitas.'
          );
        }
        const [nextStep] = await tx
          .select()
          .from(quotationDeliverySteps)
          .where(
            and(
              eq(quotationDeliverySteps.deliveryId, deliveryId),
              gt(quotationDeliverySteps.position, step.position)
            )
          )
          .orderBy(asc(quotationDeliverySteps.position))
          .limit(1);
        const nextAttemptAt =
          nextStep && ['queued', 'retry_scheduled'].includes(nextStep.state)
            ? new Date(now.getTime() + stepSnapshot(nextStep).delayMs)
            : null;
        const updated = await tx.execute(sql`
          UPDATE quotation_delivery_steps s
          SET provider_message_id = ${providerMessageId},
              state = 'server_ack',
              accepted_at = COALESCE(s.accepted_at, ${nowIso}),
              next_attempt_at = NULL,
              reconciliation_deadline = NULL,
              public_error = NULL,
              updated_at = ${nowIso}
          WHERE ${stepUpdateCondition(deliveryId, stepId, token)}
          RETURNING s.id
        `);
        if (!updated.length)
          throw new QuotationDeliveryOutboxConflictError('O lease da etapa expirou ou é inválido.');
        if (nextStep && nextAttemptAt) {
          await tx
            .update(quotationDeliverySteps)
            .set({ nextAttemptAt, updatedAt: now })
            .where(
              and(
                eq(quotationDeliverySteps.id, nextStep.id),
                eq(quotationDeliverySteps.deliveryId, deliveryId),
                inArray(quotationDeliverySteps.state, ['queued', 'retry_scheduled'])
              )
            );
        }
        await syncDeliveryState(tx, deliveryId, now);
        const cleared = await tx
          .update(quotationDeliveries)
          .set({
            leaseToken: null,
            leaseUntil: null,
            updatedAt: now,
          })
          .where(
            and(eq(quotationDeliveries.id, deliveryId), eq(quotationDeliveries.leaseToken, token))
          )
          .returning();
        if (!cleared.length)
          throw new QuotationDeliveryOutboxConflictError('O lease da etapa expirou ou é inválido.');
        const aggregate = await readAggregate(tx, deliveryId, now);
        if (!aggregate) throw new QuotationDeliveryOutboxRepositoryError();
        return aggregate;
      });
    } catch (error) {
      return rethrowRepositoryError(error);
    }
  }

  async function markFailure(input: MarkFailureInput): Promise<DeliveryAggregate> {
    const deliveryId = uuid(input?.deliveryId, 'Identificador da entrega');
    const stepId = uuid(input?.stepId, 'Identificador do passo');
    const token = uuid(input?.leaseToken, 'Lease');
    const kind = normalizeFailureKind(input?.kind);
    normalizeFailureCode(input?.code);
    const publicError = normalizePublicError(input?.publicError);
    const now = nowFrom(clock);
    try {
      const db = getDb();
      return await db.transaction(async (tx) => {
        const nowIso = now.toISOString();
        const delivery = await lockDelivery(tx, deliveryId);
        if (!delivery || delivery.leaseToken !== token) {
          throw new QuotationDeliveryOutboxConflictError('O lease da etapa expirou ou é inválido.');
        }
        const [step] = await tx
          .select()
          .from(quotationDeliverySteps)
          .where(
            and(
              eq(quotationDeliverySteps.id, stepId),
              eq(quotationDeliverySteps.deliveryId, deliveryId)
            )
          )
          .limit(1);
        if (!step || step.state !== 'sending') {
          throw new QuotationDeliveryOutboxConflictError('A etapa não está disponível para falha.');
        }
        const delay = kind === 'transient_pre_transport' ? retryDelayMs(step.attemptCount) : null;
        const targetState: DeliveryStepState =
          delay === null && kind === 'transient_pre_transport'
            ? 'failed'
            : failureTargetState(kind);
        const nextAttemptAt =
          targetState === 'retry_scheduled' ? new Date(now.getTime() + delay!) : null;
        const reconciliationDeadline =
          targetState === 'reconciling'
            ? new Date(now.getTime() + configuredReconciliationMs)
            : null;
        const updated = await tx.execute(sql`
          UPDATE quotation_delivery_steps s
          SET state = ${targetState},
              next_attempt_at = ${nextAttemptAt?.toISOString() || null},
              reconciliation_deadline = ${reconciliationDeadline?.toISOString() || null},
              public_error = ${publicError},
              updated_at = ${nowIso}
          WHERE ${stepUpdateCondition(deliveryId, stepId, token)}
          RETURNING s.id
        `);
        if (!updated.length)
          throw new QuotationDeliveryOutboxConflictError('O lease da etapa expirou ou é inválido.');
        await tx
          .update(quotationDeliveries)
          .set({ publicError })
          .where(eq(quotationDeliveries.id, deliveryId));
        await syncDeliveryState(tx, deliveryId, now);
        const cleared = await tx
          .update(quotationDeliveries)
          .set({
            leaseToken: null,
            leaseUntil: null,
            updatedAt: now,
          })
          .where(
            and(eq(quotationDeliveries.id, deliveryId), eq(quotationDeliveries.leaseToken, token))
          )
          .returning();
        if (!cleared.length)
          throw new QuotationDeliveryOutboxConflictError('O lease da etapa expirou ou é inválido.');
        const aggregate = await readAggregate(tx, deliveryId, now);
        if (!aggregate) throw new QuotationDeliveryOutboxRepositoryError();
        return aggregate;
      });
    } catch (error) {
      return rethrowRepositoryError(error);
    }
  }

  async function applyReceipt(input: ApplyReceiptInput): Promise<DeliveryAggregate | null> {
    const providerMessageId = normalizeProviderMessageId(input?.providerMessageId);
    const status = normalizeReceiptStatus(input?.status);
    const now = nowFrom(clock);
    try {
      const db = getDb();
      return await db.transaction(async (tx) => {
        const [candidate] = await tx
          .select()
          .from(quotationDeliverySteps)
          .where(eq(quotationDeliverySteps.providerMessageId, providerMessageId))
          .limit(1);
        if (!candidate) return null;
        const delivery = await lockDelivery(tx, candidate.deliveryId);
        if (!delivery) return null;
        const [step] = await tx
          .select()
          .from(quotationDeliverySteps)
          .where(
            and(
              eq(quotationDeliverySteps.id, candidate.id),
              eq(quotationDeliverySteps.deliveryId, candidate.deliveryId),
              eq(quotationDeliverySteps.providerMessageId, providerMessageId)
            )
          )
          .limit(1);
        if (!step) return null;
        const nextState = applyDeliveryReceipt(step.state as DeliveryStepState, status);
        if (nextState !== step.state) {
          const deliveredAt =
            nextState === 'delivered' || nextState === 'read'
              ? asDate(step.deliveredAt) || now
              : step.deliveredAt;
          const readAt = nextState === 'read' ? asDate(step.readAt) || now : step.readAt;
          await tx
            .update(quotationDeliverySteps)
            .set({
              state: nextState,
              deliveredAt,
              readAt,
              reconciliationDeadline: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(quotationDeliverySteps.id, step.id),
                eq(quotationDeliverySteps.deliveryId, candidate.deliveryId),
                eq(quotationDeliverySteps.providerMessageId, providerMessageId)
              )
            );
          await syncDeliveryState(tx, candidate.deliveryId, now);
        }
        return readAggregate(tx, candidate.deliveryId, now);
      });
    } catch (error) {
      return rethrowRepositoryError(error);
    }
  }

  async function expireReconciliations(limit: number): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new QuotationDeliveryOutboxInputError('Limite inválido.');
    }
    const now = nowFrom(clock);
    try {
      const db = getDb();
      return await db.transaction(async (tx) => {
        const nowIso = now.toISOString();
        const rows = (await tx.execute(sql`
          SELECT id
          FROM quotation_deliveries
          WHERE state = 'reconciling'
            AND reconciliation_deadline IS NOT NULL
            AND reconciliation_deadline <= ${nowIso}
          ORDER BY reconciliation_deadline, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        `)) as Array<{ id: string }>;
        let count = 0;
        for (const row of rows) {
          await tx
            .update(quotationDeliverySteps)
            .set({
              state: 'needs_review',
              reconciliationDeadline: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(quotationDeliverySteps.deliveryId, row.id),
                eq(quotationDeliverySteps.state, 'reconciling')
              )
            );
          await tx
            .update(quotationDeliveries)
            .set({
              state: 'needs_review',
              reconciliationDeadline: null,
              nextAttemptAt: null,
              updatedAt: now,
            })
            .where(
              and(eq(quotationDeliveries.id, row.id), eq(quotationDeliveries.state, 'reconciling'))
            );
          count += 1;
        }
        return count;
      });
    } catch (error) {
      return rethrowRepositoryError(error);
    }
  }

  async function cancelPending(): Promise<number> {
    const now = nowFrom(clock);
    try {
      const db = getDb();
      return await db.transaction(async (tx) => {
        const rows = (await tx.execute(sql`
          SELECT d.id
          FROM quotation_deliveries d
          WHERE d.state IN ('queued', 'retry_scheduled')
            AND NOT EXISTS (
              SELECT 1
              FROM quotation_delivery_steps s
              WHERE s.delivery_id = d.id
                AND s.state = 'sending'
            )
          FOR UPDATE OF d SKIP LOCKED
        `)) as Array<{ id: string }>;
        for (const row of rows) {
          await tx
            .update(quotationDeliverySteps)
            .set({
              state: 'failed',
              nextAttemptAt: null,
              reconciliationDeadline: null,
              publicError: 'Cancelada pelo operador.',
              updatedAt: now,
            })
            .where(
              and(
                eq(quotationDeliverySteps.deliveryId, row.id),
                inArray(quotationDeliverySteps.state, ['queued', 'retry_scheduled'])
              )
            );
          await tx
            .update(quotationDeliveries)
            .set({
              state: 'failed',
              nextAttemptAt: null,
              leaseToken: null,
              leaseUntil: null,
              reconciliationDeadline: null,
              completionSource: 'operator',
              resolvedBy: 'authenticated-operator',
              resolvedAt: now,
              resolutionNote: 'Fila limpa pelo operador.',
              publicError: 'Cancelada pelo operador.',
              updatedAt: now,
            })
            .where(eq(quotationDeliveries.id, row.id));
        }
        return rows.length;
      });
    } catch (error) {
      return rethrowRepositoryError(error);
    }
  }

  async function resolve(input: ResolveDeliveryInput): Promise<DeliveryAggregate> {
    if (
      !isRecord(input) ||
      (input.decision !== 'confirmed_received' && input.decision !== 'confirmed_not_received')
    ) {
      throw new QuotationDeliveryOutboxInputError('Decisão de resolução inválida.');
    }
    const deliveryId = uuid(input.deliveryId, 'Identificador da entrega');
    const note = text(input.note, 'Justificativa', MAX_NOTE, { min: 3 });
    if (input.resolvedBy !== 'authenticated-operator') {
      throw new QuotationDeliveryOutboxInputError('Responsável pela resolução inválido.');
    }
    const now = nowFrom(clock);
    try {
      const db = getDb();
      return await db.transaction(async (tx) => {
        const delivery = await lockDelivery(tx, deliveryId);
        if (!delivery) throw new QuotationDeliveryOutboxNotFoundError();
        const updatedAt = asDate(delivery.updatedAt);
        if (delivery.state !== 'needs_review' && delivery.state !== 'provider_accepted') {
          throw new QuotationDeliveryOutboxConflictError(
            'A entrega não está disponível para resolução.'
          );
        }
        if (
          delivery.state === 'provider_accepted' &&
          (!updatedAt || now.getTime() - updatedAt.getTime() < PROVIDER_DELAY_MS)
        ) {
          throw new QuotationDeliveryOutboxConflictError(
            'A entrega ainda não atingiu o prazo de resolução.'
          );
        }
        const existingSteps = await tx
          .select({ id: quotationDeliverySteps.id })
          .from(quotationDeliverySteps)
          .where(eq(quotationDeliverySteps.deliveryId, deliveryId));
        if (existingSteps.length === 0 && input.decision === 'confirmed_not_received') {
          throw new QuotationDeliveryOutboxConflictError(
            'A entrega legada não possui etapas para reenvio.'
          );
        }
        await tx
          .update(quotationDeliverySteps)
          .set(
            input.decision === 'confirmed_received'
              ? {
                  state: 'delivered',
                  deliveredAt: sql`COALESCE(${quotationDeliverySteps.deliveredAt}, ${now.toISOString()})`,
                  nextAttemptAt: null,
                  reconciliationDeadline: null,
                  publicError: null,
                  updatedAt: now,
                }
              : {
                  state: 'queued',
                  providerMessageId: null,
                  acceptedAt: null,
                  nextAttemptAt: null,
                  reconciliationDeadline: null,
                  publicError: null,
                  updatedAt: now,
                }
          )
          .where(
            and(
              eq(quotationDeliverySteps.deliveryId, deliveryId),
              notInArray(quotationDeliverySteps.state, ['delivered', 'read'])
            )
          );
        if (input.decision === 'confirmed_not_received') {
          const [nextStep] = await tx
            .select()
            .from(quotationDeliverySteps)
            .where(
              and(
                eq(quotationDeliverySteps.deliveryId, deliveryId),
                eq(quotationDeliverySteps.state, 'queued')
              )
            )
            .orderBy(asc(quotationDeliverySteps.position))
            .limit(1);
          if (nextStep) {
            await tx
              .update(quotationDeliverySteps)
              .set({
                nextAttemptAt: new Date(now.getTime() + stepSnapshot(nextStep).delayMs),
                updatedAt: now,
              })
              .where(eq(quotationDeliverySteps.id, nextStep.id));
          }
        }
        await tx
          .update(quotationDeliveries)
          .set({
            resolvedBy: input.resolvedBy,
            resolvedAt: now,
            resolutionNote: note,
            completionSource: input.decision === 'confirmed_received' ? 'operator' : null,
            publicError: null,
            leaseToken: null,
            leaseUntil: null,
            updatedAt: now,
          })
          .where(eq(quotationDeliveries.id, deliveryId));
        await syncDeliveryState(
          tx,
          deliveryId,
          now,
          input.decision === 'confirmed_received' ? 'operator' : null,
          existingSteps.length === 0 && input.decision === 'confirmed_received'
            ? 'delivered'
            : undefined
        );
        const aggregate = await readAggregate(tx, deliveryId, now);
        if (!aggregate) throw new QuotationDeliveryOutboxRepositoryError();
        return aggregate;
      });
    } catch (error) {
      return rethrowRepositoryError(error);
    }
  }

  return {
    enqueue,
    get,
    getByIdentity,
    list,
    claim,
    markAccepted,
    markFailure,
    applyReceipt,
    expireReconciliations,
    cancelPending,
    resolve,
  };
}

export const createQuotationDeliveryOutboxRepository =
  createPostgresQuotationDeliveryOutboxRepository;
