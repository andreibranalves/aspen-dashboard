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
  isNull,
  lte,
  lt,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import {
  evolutionReceiptInbox,
  quoteRevisions,
  quotations,
  quotationDeliveries,
  quotationDeliverySteps,
} from '../schema.js';
import { promoteDealOnProviderAcceptance } from './crm-deals-repository.js';
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
// Receipt statuses that carry the provider delivery clock. `PLAYED` means the
// same as `READ` for our state machine, so it dates the delivery identically.
const RECEIPT_CLOCK_STATUSES: readonly EvolutionReceiptStatus[] = ['DELIVERY_ACK', 'READ', 'PLAYED'];
const READ_CLOCK_STATUSES: readonly EvolutionReceiptStatus[] = ['READ', 'PLAYED'];
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
const RECEIPT_RETENTION_MS = 30 * 86_400_000;
const RECEIPT_RETENTION_BATCH = 200;

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
    }
  | {
      position: number;
      type: 'quotation_webp';
      payload: {
        revisionId: string;
        fileName: string;
        caption: string;
        page: number;
        pageCount: number;
      };
      delayMs: number;
    };

export interface DeliveryStepView {
  id: string;
  position: number;
  type: FrozenDeliveryStep['type'];
  state: DeliveryStepState;
  attemptCount: number;
  publicError: string | null;
  /** Failure class of the last attempt; both pre-transport classes are re-sendable. */
  failureKind: TransportFailureKind | null;
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
  revisionId?: string;
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

export interface ExpandQuotationWebpStepInput {
  deliveryId: string;
  stepId: string;
  leaseToken: string;
  steps: Array<Extract<FrozenDeliveryStep, { type: 'quotation_webp' }>>;
}

export interface MarkAcceptedInput {
  deliveryId: string;
  stepId: string;
  leaseToken: string;
  providerMessageId: string;
}

export interface RenewLeaseInput {
  deliveryId: string;
  stepId: string;
  leaseToken: string;
}

export interface MarkFailureInput {
  deliveryId: string;
  stepId: string;
  leaseToken: string;
  kind: TransportFailureKind;
  code: string;
  publicError: string;
}

export interface ReceiveReceiptInput {
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
    }
  | {
      deliveryId: string;
      decision: 'retry_same_revision';
      note: string;
      resolvedBy: 'authenticated-operator';
    };

export interface QuotationDeliveryOutboxRepository {
  enqueue(input: EnqueueDeliveryRecord): Promise<DeliveryAggregate>;
  get(deliveryId: string): Promise<DeliveryAggregate | null>;
  getByIdentity(identity: DeliveryIdentity): Promise<DeliveryAggregate | null>;
  list(filters: DeliveryListFilters): Promise<DeliveryListResult>;
  claim(input?: { deliveryId?: string }): Promise<ClaimedDeliveryStep | null>;
  renewLease(input: RenewLeaseInput): Promise<boolean>;
  expandQuotationWebpStep(input: ExpandQuotationWebpStepInput): Promise<void>;
  markAccepted(input: MarkAcceptedInput): Promise<DeliveryAggregate>;
  markFailure(input: MarkFailureInput): Promise<DeliveryAggregate>;
  receiveReceipt(input: ReceiveReceiptInput): Promise<DeliveryAggregate | null>;
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
  if (value.type === 'quotation_webp') {
    if (
      !isRecord(value.payload) ||
      !exactKeys(value.payload, ['revisionId', 'fileName', 'caption', 'page', 'pageCount']) ||
      !Number.isInteger(value.payload.page) ||
      !Number.isInteger(value.payload.pageCount) ||
      (value.payload.page as number) < 0 ||
      (value.payload.pageCount as number) < 0 ||
      (value.payload.page as number) > MAX_STEPS ||
      (value.payload.pageCount as number) > MAX_STEPS ||
      ((value.payload.pageCount as number) > 0 &&
        ((value.payload.page as number) < 1 ||
          (value.payload.page as number) > (value.payload.pageCount as number)))
    ) {
      throw new QuotationDeliveryOutboxInputError('Snapshot de entrega inválido.');
    }
    return {
      position,
      type: 'quotation_webp',
      payload: {
        revisionId: uuid(value.payload.revisionId, 'Identificador da revisão'),
        fileName: text(value.payload.fileName, 'Nome do arquivo', MAX_SNAPSHOT_FILE_NAME),
        caption: text(value.payload.caption, 'Legenda do passo', MAX_SNAPSHOT_TEXT, { min: 0 }),
        page: value.payload.page as number,
        pageCount: value.payload.pageCount as number,
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
  const revisionId = input.revisionId === undefined
    ? undefined
    : uuid(input.revisionId, 'Identificador da revisão');
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
    revisionId,
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

function safeFailureKind(value: unknown): TransportFailureKind | null {
  return FAILURE_KINDS.includes(value as TransportFailureKind)
    ? (value as TransportFailureKind)
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
    failureKind: safeFailureKind(row.failureKind),
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

// Lease authority must come from the database clock, read inside the locked
// transaction. The application clock can be skewed and, more importantly, a
// timestamp captured before a row-lock wait is already stale by the time the
// lock is granted; recovery evaluates the lease against this same clock.
async function databaseClock(db: DeliveryDatabase): Promise<Date> {
  const rows = (await db.execute(sql`SELECT clock_timestamp() AS now`)) as unknown as Array<{
    now: Date | string | null;
  }>;
  const value = asDate(rows[0]?.now);
  if (!value) throw new QuotationDeliveryOutboxRepositoryError();
  return value;
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
  // An operator cancellation (`cancelPending`) is terminal: a later receipt may
  // move an already accepted step to `needs_review`/`delivered`, but it must
  // never reopen the delivery or clear its operator completion marker.
  const operatorCancelled =
    delivery.state === 'failed' && safeCompletionSource(delivery.completionSource) === 'operator';
  const state = operatorCancelled
    ? 'failed'
    : stateOverride ||
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
  const completionSource = operatorCancelled
    ? 'operator'
    : completionSourceOverride !== undefined
      ? completionSourceOverride
      : state === 'delivered'
        ? safeCompletionSource(delivery.completionSource) || 'provider_receipt'
        : null;
  const deliveredAt =
    state === 'delivered' ? asDate(delivery.deliveredAt) || new Date(now.getTime()) : null;
  // A delivery-level error is stale once no step still carries one (for example
  // after a delayed DELIVERY_ACK/READ cleared the step that had failed).
  const hasStepError = steps.some((step) => step.publicError);
  const publicError =
    state === 'delivered' ? null : steps.length === 0 || hasStepError ? delivery.publicError : null;
  await db
    .update(quotationDeliveries)
    .set({
      state,
      nextAttemptAt,
      reconciliationDeadline,
      completionSource,
      deliveredAt,
      publicError,
      updatedAt: now,
    })
    .where(eq(quotationDeliveries.id, deliveryId));
  const fullyAcceptedByProvider =
    steps.length > 0 &&
    steps.every((step) => step.providerMessageId !== null && asDate(step.acceptedAt) !== null);
  const acceptedNow =
    fullyAcceptedByProvider &&
    state !== delivery.state &&
    (state === 'provider_accepted' || state === 'delivered');
  if (acceptedNow) {
    await promoteDealOnProviderAcceptance(db, { revisionId: delivery.revisionId }, { now });
  }
}

/**
 * Folds every pending inbox receipt for one provider message id into its
 * correlated step, in received order. Receipt state is monotonic and operator
 * cancellations (`failed`) never regress, so duplicate callbacks are no-ops.
 * Rows stay pending while the id is not correlated yet (receipt raced ahead of
 * `markAccepted`); `markAccepted` re-runs this in the same transaction that
 * persists the provider id, which makes the correlation durable without any
 * provider replay.
 */
async function applyPendingReceipts(
  db: DeliveryDatabase,
  providerMessageId: string,
  now: Date
): Promise<string | null> {
  const [candidate] = await db
    .select()
    .from(quotationDeliverySteps)
    .where(eq(quotationDeliverySteps.providerMessageId, providerMessageId))
    .limit(1);
  if (!candidate) return null;
  const delivery = await lockDelivery(db, candidate.deliveryId);
  if (!delivery) return null;
  const pending = await db
    .select({
      status: evolutionReceiptInbox.status,
      receivedAt: evolutionReceiptInbox.receivedAt,
    })
    .from(evolutionReceiptInbox)
    .where(
      and(
        eq(evolutionReceiptInbox.providerMessageId, providerMessageId),
        isNull(evolutionReceiptInbox.appliedAt)
      )
    )
    .orderBy(asc(evolutionReceiptInbox.receivedAt));
  const [step] = await db
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
  const nextState = pending.reduce(
    (state, row) => applyDeliveryReceipt(state, row.status as EvolutionReceiptStatus),
    step.state as DeliveryStepState
  );
  if (nextState !== step.state) {
    // The durable inbox `received_at` is the true provider receipt time. Using
    // the clock at fold time would shift `first_provider_receipt_at` and the
    // follow-up due time whenever a receipt is folded later (for example during
    // an acceptance that happens after the receipt arrived). The earliest
    // delivery-confirming receipt dates the delivery; the earliest READ/PLAYED
    // dates the read, so a read-after-delivery never overwrites the delivery
    // clock. `PLAYED` advances the step to `read` exactly like `READ`, so it must
    // participate in the durable clock folding too: an early `PLAYED` folded
    // during a later acceptance must not fall back to the acceptance clock.
    const receiptTimes = pending
      .filter((row) => RECEIPT_CLOCK_STATUSES.includes(row.status as EvolutionReceiptStatus))
      .map((row) => ({ status: row.status as EvolutionReceiptStatus, at: asDate(row.receivedAt) }))
      .filter((entry): entry is { status: EvolutionReceiptStatus; at: Date } => entry.at !== null)
      .sort((left, right) => left.at.getTime() - right.at.getTime());
    const firstReceiptAt = receiptTimes[0]?.at || null;
    const firstReadAt = receiptTimes.find((entry) => READ_CLOCK_STATUSES.includes(entry.status))?.at || null;
    const deliveredAt =
      nextState === 'delivered' || nextState === 'read'
        ? asDate(step.deliveredAt) || firstReceiptAt || now
        : step.deliveredAt;
    const readAt =
      nextState === 'read'
        ? asDate(step.readAt) || firstReadAt || firstReceiptAt || now
        : step.readAt;
    const receiptArrived = nextState === 'delivered' || nextState === 'read';
    await db
      .update(quotationDeliverySteps)
      .set({
        state: nextState,
        deliveredAt,
        readAt,
        reconciliationDeadline: null,
        // A successful delayed receipt clears the error that was blocking the step.
        publicError: receiptArrived ? null : step.publicError,
        updatedAt: now,
      })
      .where(
        and(
          eq(quotationDeliverySteps.id, step.id),
          eq(quotationDeliverySteps.deliveryId, candidate.deliveryId),
          eq(quotationDeliverySteps.providerMessageId, providerMessageId)
        )
      );
    await syncDeliveryState(db, candidate.deliveryId, now);
  }
  if (pending.length > 0) {
    await db
      .update(evolutionReceiptInbox)
      .set({ appliedAt: now })
      .where(
        and(
          eq(evolutionReceiptInbox.providerMessageId, providerMessageId),
          isNull(evolutionReceiptInbox.appliedAt)
        )
      );
  }
  return candidate.deliveryId;
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
  if (filters.revisionId) conditions.push(eq(quotationDeliveries.revisionId, filters.revisionId));
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
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(hashtextextended(${normalized.revisionId}, 0))
        `);
        const [existingRevisionDelivery] = await tx
          .select({ id: quotationDeliveries.id, flowId: quotationDeliveries.flowId })
          .from(quotationDeliveries)
          .where(eq(quotationDeliveries.revisionId, normalized.revisionId))
          .limit(1);
        if (existingRevisionDelivery) {
          if (existingRevisionDelivery.flowId !== normalized.flowId) {
            throw new QuotationDeliveryOutboxConflictError(
              'Este orçamento já possui uma entrega pelo WhatsApp.'
            );
          }
          const existing = await readAggregate(tx, existingRevisionDelivery.id, now);
          if (!existing) throw new QuotationDeliveryOutboxRepositoryError();
          return existing;
        }
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

  async function expandQuotationWebpStep(input: ExpandQuotationWebpStepInput): Promise<void> {
    const deliveryId = uuid(input?.deliveryId, 'Identificador da entrega');
    const stepId = uuid(input?.stepId, 'Identificador do passo');
    const leaseToken = uuid(input?.leaseToken, 'Lease');
    if (!Array.isArray(input?.steps) || input.steps.length < 1 || input.steps.length > MAX_STEPS) {
      throw new QuotationDeliveryOutboxInputError('Páginas WebP inválidas.');
    }
    const now = nowFrom(clock);
    try {
      const db = getDb();
      await db.transaction(async (tx) => {
        const delivery = await lockDelivery(tx, deliveryId);
        if (!delivery || delivery.leaseToken !== leaseToken) {
          throw new QuotationDeliveryOutboxConflictError('O lease da etapa expirou ou é inválido.');
        }
        const [current] = await tx
          .select()
          .from(quotationDeliverySteps)
          .where(
            and(
              eq(quotationDeliverySteps.id, stepId),
              eq(quotationDeliverySteps.deliveryId, deliveryId),
            ),
          )
          .limit(1);
        if (!current || current.state !== 'sending' || current.type !== 'quotation_webp') {
          throw new QuotationDeliveryOutboxConflictError('A etapa WebP não está disponível para expansão.');
        }
        const currentSnapshot = stepSnapshot(current);
        if (currentSnapshot.type !== 'quotation_webp' || currentSnapshot.payload.page !== 0) {
          throw new QuotationDeliveryOutboxConflictError('A etapa WebP já foi expandida.');
        }
        const rows = await tx
          .select({ id: quotationDeliverySteps.id })
          .from(quotationDeliverySteps)
          .where(eq(quotationDeliverySteps.deliveryId, deliveryId));
        if (rows.length + input.steps.length - 1 > MAX_STEPS) {
          throw new QuotationDeliveryOutboxInputError('O orçamento excede o limite de páginas WebP.');
        }
        const pages = input.steps.map((step, index) => {
          if (
            step.type !== 'quotation_webp' ||
            step.payload.revisionId !== currentSnapshot.payload.revisionId ||
            step.payload.page !== index + 1 ||
            step.payload.pageCount !== input.steps.length
          ) {
            throw new QuotationDeliveryOutboxInputError('Páginas WebP inválidas.');
          }
          return normalizeSnapshot({
            position: current.position + index,
            type: step.type,
            payload: step.payload,
            delayMs: step.delayMs,
          });
        });
        await tx
          .update(quotationDeliverySteps)
          .set({
            position: sql`${quotationDeliverySteps.position} + ${MAX_STEPS}`,
          })
          .where(
            and(
              eq(quotationDeliverySteps.deliveryId, deliveryId),
              gt(quotationDeliverySteps.position, current.position),
            ),
          );
        const first = pages[0]!;
        await tx
          .update(quotationDeliverySteps)
          .set({
            position: first.position,
            type: first.type,
            payloadSnapshot: { ...first.payload, delayMs: first.delayMs },
            state: 'queued',
            attemptCount: 0,
            nextAttemptAt: now,
            reconciliationDeadline: null,
            publicError: null,
            acceptedAt: null,
            deliveredAt: null,
            readAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(quotationDeliverySteps.id, stepId),
              eq(quotationDeliverySteps.deliveryId, deliveryId),
            ),
          );
        if (pages.length > 1) {
          await tx.insert(quotationDeliverySteps).values(
            pages.slice(1).map((page) => ({
              id: randomUUID(),
              deliveryId,
              position: page.position,
              type: page.type,
              payloadSnapshot: { ...page.payload, delayMs: page.delayMs },
              state: 'queued' as const,
              attemptCount: 0,
              nextAttemptAt: null,
              createdAt: now,
              updatedAt: now,
            })),
          );
        }
        await tx
          .update(quotationDeliverySteps)
          .set({
            position: sql`${quotationDeliverySteps.position} - ${MAX_STEPS} + ${pages.length - 1}`,
          })
          .where(
            and(
              eq(quotationDeliverySteps.deliveryId, deliveryId),
              gt(quotationDeliverySteps.position, current.position + MAX_STEPS),
            ),
          );
        await syncDeliveryState(tx, deliveryId, now);
        const cleared = await tx
          .update(quotationDeliveries)
          .set({ leaseToken: null, leaseUntil: null, updatedAt: now })
          .where(
            and(
              eq(quotationDeliveries.id, deliveryId),
              eq(quotationDeliveries.leaseToken, leaseToken),
            ),
          )
          .returning({ id: quotationDeliveries.id });
        if (!cleared.length) {
          throw new QuotationDeliveryOutboxConflictError('O lease da etapa expirou ou é inválido.');
        }
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
        // Expired recovery and pre-dispatch renewal must serialize on the same
        // delivery row. Lock the delivery (FOR UPDATE) before touching any step
        // and re-evaluate `lease_until` under that lock: a worker that renewed
        // concurrently extended the lease, so the predicate no longer matches
        // and recovery cannot revoke a live owner. A worker that lost the race
        // finds its token revoked here and makes zero provider calls.
        const expired = (await tx.execute(sql`
          SELECT d.id
          FROM quotation_deliveries d
          WHERE d.lease_until IS NOT NULL
            AND d.lease_until <= clock_timestamp()
            AND (${requestedId}::uuid IS NULL OR d.id = ${requestedId}::uuid)
            AND EXISTS (
              SELECT 1
              FROM quotation_delivery_steps s
              WHERE s.delivery_id = d.id
                AND s.state = 'sending'
                AND s.provider_message_id IS NULL
            )
          FOR UPDATE OF d SKIP LOCKED
        `)) as Array<{ id: string }>;
        for (const { id: deliveryId } of expired) {
          await tx
            .update(quotationDeliverySteps)
            .set({
              state: 'reconciling',
              nextAttemptAt: null,
              reconciliationDeadline: new Date(now.getTime() + configuredReconciliationMs),
              updatedAt: now,
            })
            .where(
              and(
                eq(quotationDeliverySteps.deliveryId, deliveryId),
                eq(quotationDeliverySteps.state, 'sending'),
                isNull(quotationDeliverySteps.providerMessageId)
              )
            );
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
            AND (d.lease_until IS NULL OR d.lease_until <= clock_timestamp())
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
        // The lease clock is read under the same row lock as the selection, from
        // the database, so the granted lease is live at the moment it is granted.
        const leaseNow = await databaseClock(tx);
        const until = leaseUntil(leaseNow, configuredLeaseMs);
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

  async function renewLease(input: RenewLeaseInput): Promise<boolean> {
    const deliveryId = uuid(input?.deliveryId, 'Identificador da entrega');
    const stepId = uuid(input?.stepId, 'Identificador do passo');
    const token = uuid(input?.leaseToken, 'Lease');
    try {
      const db = getDb();
      return await db.transaction(async (tx) => {
        // Take the same delivery row lock as expired recovery before reading
        // state, so the two orders are strictly serialized:
        // - renewal first extends `lease_until`, so recovery's expiry predicate
        //   no longer matches and cannot revoke a live owner;
        // - recovery first revokes the token / moves the step to `reconciling`,
        //   so this renewal fails and the worker never reaches the provider.
        const delivery = await lockDelivery(tx, deliveryId);
        if (!delivery || delivery.leaseToken !== token) return false;
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
        if (!step || step.state !== 'sending') return false;
        // Read the database clock only after the serialization lock is granted,
        // so a lock wait longer than the requested lease can never write an
        // already-expired `lease_until` and still return true.
        const leaseNow = await databaseClock(tx);
        const updated = await tx
          .update(quotationDeliveries)
          .set({
            leaseUntil: leaseUntil(leaseNow, configuredLeaseMs),
            updatedAt: leaseNow,
          })
          .where(
            and(
              eq(quotationDeliveries.id, deliveryId),
              eq(quotationDeliveries.leaseToken, token)
            )
          )
          .returning({ id: quotationDeliveries.id });
        return updated.length > 0;
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
        // Same lock as `receiveReceipt`: an early receipt is either folded here
        // (its inbox row is already committed and visible) or it will fold
        // itself after this transaction commits — the receipt cannot be lost.
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(hashtextextended(${providerMessageId}, 0))
        `);
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
              failure_kind = NULL,
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
        // Receipts that arrived before this acceptance was persisted are folded
        // in now, monotonically, without any provider replay.
        await applyPendingReceipts(tx, providerMessageId, now);
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
              failure_kind = ${kind},
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

  async function receiveReceipt(input: ReceiveReceiptInput): Promise<DeliveryAggregate | null> {
    const providerMessageId = normalizeProviderMessageId(input?.providerMessageId);
    const status = normalizeReceiptStatus(input?.status);
    const now = nowFrom(clock);
    try {
      const db = getDb();
      return await db.transaction(async (tx) => {
        // Serializes with `markAccepted` for the same provider message id so the
        // inbox row is either folded into the step inside markAccepted's
        // transaction or picked up by this one — never dropped between them.
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(hashtextextended(${providerMessageId}, 0))
        `);
        await tx
          .insert(evolutionReceiptInbox)
          .values({
            id: randomUUID(),
            providerMessageId,
            status,
            receivedAt: now,
          })
          .onConflictDoNothing({
            target: [evolutionReceiptInbox.providerMessageId, evolutionReceiptInbox.status],
          });
        await pruneReceiptInbox(tx, now);
        const deliveryId = await applyPendingReceipts(tx, providerMessageId, now);
        return deliveryId ? readAggregate(tx, deliveryId, now) : null;
      });
    } catch (error) {
      return rethrowRepositoryError(error);
    }
  }

  async function pruneReceiptInbox(db: DeliveryDatabase, now: Date): Promise<void> {
    // Age-based, regardless of `applied_at`: an id that never correlates (for
    // example an outbound message from a path with no outbox step) must not grow
    // the table forever. No acceptance can legitimately land this long after a
    // receipt, since a step is accepted within the lease/reconciliation window.
    const cutoff = new Date(now.getTime() - RECEIPT_RETENTION_MS).toISOString();
    await db.execute(sql`
      DELETE FROM evolution_receipt_inbox
      WHERE id IN (
        SELECT id
        FROM evolution_receipt_inbox
        WHERE received_at <= ${cutoff}
        ORDER BY received_at
        LIMIT ${RECEIPT_RETENTION_BATCH}
      )
    `);
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
      (input.decision !== 'confirmed_received' &&
        input.decision !== 'confirmed_not_received' &&
        input.decision !== 'retry_same_revision')
    ) {
      throw new QuotationDeliveryOutboxInputError('Decisão de resolução inválida.');
    }
    const decision = input.decision;
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
        // A persisted `sending` step is an in-flight dispatch that may already be
        // at the provider, even when its lease timestamp elapsed: the worker can
        // be slow, not dead. Manual resolution must not reinterpret, requeue or
        // release it, because clearing the lease would orphan the step (nothing
        // could ever reclaim or classify it). The step's own external result —
        // or the worker's reconciliation, which requires the lease to recover —
        // is the only honest classifier.
        const [sendingStep] = await tx
          .select({ id: quotationDeliverySteps.id })
          .from(quotationDeliverySteps)
          .where(
            and(
              eq(quotationDeliverySteps.deliveryId, deliveryId),
              eq(quotationDeliverySteps.state, 'sending')
            )
          )
          .limit(1);
        if (sendingStep) {
          throw new QuotationDeliveryOutboxConflictError(
            'Há um envio em andamento. Aguarde a conclusão antes de resolver.'
          );
        }
        // A live lease means a worker already owns a `sending` step and may have
        // handed it to the provider. Manual resolution must not reinterpret,
        // revoke or reschedule that dispatch until its external result is
        // durably classified (accepted or failed).
        const leaseExpiresAt = asDate(delivery.leaseUntil);
        if (delivery.leaseToken && leaseExpiresAt && leaseExpiresAt.getTime() > now.getTime()) {
          throw new QuotationDeliveryOutboxConflictError(
            'Há um envio em andamento. Aguarde a conclusão antes de resolver.'
          );
        }
        const updatedAt = asDate(delivery.updatedAt);
        const retrySameRevision = decision === 'retry_same_revision';
        if (retrySameRevision) {
          // Re-sending is authorized only for a delivery whose whole sequence
          // failed *before* transport. An operator cancellation is deliberate and
          // terminal, and an accepted/reconciled step would mean something
          // reached the provider, so neither is retryable here.
          if (
            delivery.state !== 'failed' ||
            safeCompletionSource(delivery.completionSource) === 'operator'
          ) {
            throw new QuotationDeliveryOutboxConflictError(
              'A entrega não está disponível para reenvio.'
            );
          }
        } else if (delivery.state !== 'needs_review' && delivery.state !== 'provider_accepted') {
          throw new QuotationDeliveryOutboxConflictError(
            'A entrega não está disponível para resolução.'
          );
        }
        if (
          !retrySameRevision &&
          delivery.state === 'provider_accepted' &&
          (!updatedAt || now.getTime() - updatedAt.getTime() < PROVIDER_DELAY_MS)
        ) {
          throw new QuotationDeliveryOutboxConflictError(
            'A entrega ainda não atingiu o prazo de resolução.'
          );
        }
        const existingSteps = await tx
          .select({
            id: quotationDeliverySteps.id,
            state: quotationDeliverySteps.state,
            failureKind: quotationDeliverySteps.failureKind,
            providerMessageId: quotationDeliverySteps.providerMessageId,
            acceptedAt: quotationDeliverySteps.acceptedAt,
          })
          .from(quotationDeliverySteps)
          .where(eq(quotationDeliverySteps.deliveryId, deliveryId));
        if (existingSteps.length === 0 && decision === 'confirmed_not_received') {
          throw new QuotationDeliveryOutboxConflictError(
            'A entrega legada não possui etapas para reenvio.'
          );
        }
        // The only proof that a dispatch never left the machine: the step is
        // `failed` (never accepted), its last attempt was classified
        // pre-transport — `permanent_pre_transport` (4xx, invalid configuration,
        // invalid recipient, local block) or an exhausted
        // `transient_pre_transport` (429/render budget) — and it carries no
        // provider identifier nor acceptance clock. `ambiguous` never reaches
        // `failed`, so timeout, 5xx and lost responses keep the block untouched.
        const retryableStepIds = existingSteps
          .filter(
            (step) =>
              step.state === 'failed' &&
              (step.failureKind === 'permanent_pre_transport' ||
                step.failureKind === 'transient_pre_transport') &&
              step.providerMessageId === null &&
              step.acceptedAt === null
          )
          .map((step) => step.id);
        if (retrySameRevision && retryableStepIds.length === 0) {
          throw new QuotationDeliveryOutboxConflictError(
            'Não há falha anterior ao transporte para reenviar.'
          );
        }
        const resolutionConditions = [
          eq(quotationDeliverySteps.deliveryId, deliveryId),
          // `sending` is an in-flight dispatch: never reinterpreted or requeued
          // by a manual decision. `failed` covers operator-cancelled steps,
          // which must never be revived.
          notInArray(quotationDeliverySteps.state, ['delivered', 'read', 'sending', 'failed']),
        ];
        if (decision === 'confirmed_received') {
          // `confirmed_received` is evidence that the messages already handed to
          // the provider arrived — never a licence to retire steps that were
          // never attempted (`queued`/`retry_scheduled`) or explicitly
          // cancelled (`failed`). Only accepted or ambiguous dispatches are
          // promoted; the unsent remainder keeps its own honest state.
          resolutionConditions.push(
            inArray(quotationDeliverySteps.state, ['server_ack', 'reconciling', 'needs_review']),
          );
        }
        if (retrySameRevision) {
          // Only the proven pre-transport failures are revived; already
          // delivered steps and every other state stay exactly as they are.
          resolutionConditions.length = 0;
          resolutionConditions.push(
            eq(quotationDeliverySteps.deliveryId, deliveryId),
            inArray(quotationDeliverySteps.id, retryableStepIds),
          );
        }
        await tx
          .update(quotationDeliverySteps)
          .set(
            decision === 'confirmed_received'
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
                  failureKind: null,
                  updatedAt: now,
                }
          )
          .where(and(...resolutionConditions));
        const [nextStep] = await tx
          .select()
          .from(quotationDeliverySteps)
          .where(
            and(
              eq(quotationDeliverySteps.deliveryId, deliveryId),
              inArray(quotationDeliverySteps.state, ['queued', 'retry_scheduled'])
            )
          )
          .orderBy(asc(quotationDeliverySteps.position))
          .limit(1);
        if (nextStep && nextStep.nextAttemptAt === null) {
          await tx
            .update(quotationDeliverySteps)
            .set({
              nextAttemptAt: new Date(now.getTime() + stepSnapshot(nextStep).delayMs),
              updatedAt: now,
            })
            .where(eq(quotationDeliverySteps.id, nextStep.id));
        }
        await tx
          .update(quotationDeliveries)
          .set({
            resolvedBy: input.resolvedBy,
            resolvedAt: now,
            resolutionNote: note,
            completionSource: decision === 'confirmed_received' ? 'operator' : null,
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
          undefined,
          existingSteps.length === 0 && decision === 'confirmed_received'
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
    renewLease,
    expandQuotationWebpStep,
    markAccepted,
    markFailure,
    receiveReceipt,
    expireReconciliations,
    cancelPending,
    resolve,
  };
}

export const createQuotationDeliveryOutboxRepository =
  createPostgresQuotationDeliveryOutboxRepository;
