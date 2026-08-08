import { createHash, randomUUID } from 'node:crypto';

import {
  and,
  asc,
  eq,
  gt,
  isNull,
  lte,
  or,
} from 'drizzle-orm';

import { getDatabase, type AppDatabase } from './client.js';
import { quoteRevisions, quotations, quotationOutboxEvents } from './schema.js';

type OutboxTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
export type OutboxDatabase = AppDatabase | OutboxTransaction;

export const QUOTATION_OUTBOX_EVENT_TYPES = [
  'quotation.created',
  'quotation.updated',
  'quotation.issued',
  'quotation.sent',
] as const;
export type QuotationOutboxEventType = (typeof QUOTATION_OUTBOX_EVENT_TYPES)[number];

export const QUOTATION_OUTBOX_PROVIDERS = ['n8n', 'evolution', 'crm'] as const;
export type QuotationOutboxProvider = (typeof QUOTATION_OUTBOX_PROVIDERS)[number];

export const QUOTATION_OUTBOX_STATUSES = [
  'pending',
  'processing',
  'retry',
  'delivered',
  'dead_letter',
] as const;
export type QuotationOutboxStatus = (typeof QUOTATION_OUTBOX_STATUSES)[number];

export interface QuotationOutboxPayloadReference {
  quotationId: string;
  revisionId: string;
  businessNumber: string;
}

export interface EnqueueQuotationOutboxInput extends QuotationOutboxPayloadReference {
  eventType: QuotationOutboxEventType;
  provider: QuotationOutboxProvider;
  /**
   * Callers should include the immutable revision/version or aggregate
   * updated-at token when an event can occur more than once.
   */
  idempotencyKey?: string;
  now?: Date;
}

type QuotationOutboxRow = typeof quotationOutboxEvents.$inferSelect;
export type QuotationOutboxEvent = Omit<QuotationOutboxRow, 'eventType' | 'provider' | 'status'> & {
  eventType: QuotationOutboxEventType;
  provider: QuotationOutboxProvider;
  status: QuotationOutboxStatus;
};

export interface ClaimDueOutboxOptions {
  owner: string;
  limit?: number;
  leaseMs?: number;
  now?: Date;
}

export interface QuotationOutboxRepositoryOptions {
  now?: () => Date;
  idFactory?: () => string;
  retryBaseMs?: number;
  retryMaxMs?: number;
  maxAttempts?: number;
}

export class QuotationOutboxIdempotencyConflictError extends Error {
  constructor(idempotencyKey: string) {
    super(`Chave de idempotência já está vinculada a outro evento: ${idempotencyKey}`);
    this.name = 'QuotationOutboxIdempotencyConflictError';
  }
}

export class QuotationOutboxOwnershipError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('A revisão não pertence ao orçamento PostgreSQL informado.');
    this.name = 'QuotationOutboxOwnershipError';
  }
}

export class QuotationOutboxDurabilityError extends Error {
  readonly statusCode = 503;
  readonly providerAccepted = true;
  readonly outboxDurable = false;
  readonly alertId = randomUUID();

  constructor(cause?: unknown) {
    super('Mensagem enviada, mas não foi possível registrar o efeito durável. Não repita automaticamente.');
    this.name = 'QuotationOutboxDurabilityError';
    if (cause instanceof Error) this.cause = cause;
  }
}

export interface QuotationOutboxRepository {
  enqueue(
    input: EnqueueQuotationOutboxInput,
    transaction?: OutboxDatabase
  ): Promise<QuotationOutboxEvent>;
  enqueueInTransaction(
    transaction: OutboxDatabase,
    input: EnqueueQuotationOutboxInput
  ): Promise<QuotationOutboxEvent>;
  claimDueEvents(options: ClaimDueOutboxOptions): Promise<QuotationOutboxEvent[]>;
  markDelivered(
    id: string,
    owner: string,
    providerMessageId?: string | null,
    now?: Date
  ): Promise<QuotationOutboxEvent | null>;
  markFailed(
    id: string,
    owner: string,
    error: unknown,
    now?: Date
  ): Promise<QuotationOutboxEvent | null>;
  get(id: string): Promise<QuotationOutboxEvent | null>;
  list(): Promise<QuotationOutboxEvent[]>;
}

const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LEASE_MS = 60_000;
const MAX_LEASE_MS = 60 * 60 * 1_000;
const MAX_BATCH_SIZE = 100;
const MAX_OWNER_LENGTH = 128;
const MAX_IDEMPOTENCY_LENGTH = 255;

function validDate(value: Date | undefined, fallback: Date): Date {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : fallback;
}

function boundedPositive(value: number | undefined, fallback: number, maximum: number): number {
  return Number.isFinite(value) && (value as number) > 0
    ? Math.min(Math.floor(value as number), maximum)
    : fallback;
}

function normalizeOwner(value: string): string {
  const owner = String(value || '').trim();
  if (!owner || owner.length > MAX_OWNER_LENGTH) {
    throw new Error('Outbox lease owner inválido.');
  }
  return owner;
}

function normalizeEventType(value: unknown): QuotationOutboxEventType {
  if (
    typeof value === 'string' &&
    (QUOTATION_OUTBOX_EVENT_TYPES as readonly string[]).includes(value)
  ) {
    return value as QuotationOutboxEventType;
  }
  throw new Error('Tipo de evento de orçamento inválido.');
}

function normalizeProvider(value: unknown): QuotationOutboxProvider {
  if (
    typeof value === 'string' &&
    (QUOTATION_OUTBOX_PROVIDERS as readonly string[]).includes(value)
  ) {
    return value as QuotationOutboxProvider;
  }
  throw new Error('Provedor do evento de orçamento inválido.');
}

function normalizeStatus(value: unknown): QuotationOutboxStatus {
  if (
    typeof value === 'string' &&
    (QUOTATION_OUTBOX_STATUSES as readonly string[]).includes(value)
  ) {
    return value as QuotationOutboxStatus;
  }
  throw new Error('Estado do outbox inválido.');
}

function normalizePayloadReference(value: unknown): QuotationOutboxPayloadReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Referência canônica do outbox inválida.');
  }
  const reference = value as Record<string, unknown>;
  return {
    quotationId: canonicalText(reference.quotationId, 'Identificador canônico do orçamento'),
    revisionId: canonicalText(reference.revisionId, 'Identificador canônico da revisão'),
    businessNumber: canonicalText(reference.businessNumber, 'Número canônico do orçamento'),
  };
}

function asEvent(row: QuotationOutboxRow): QuotationOutboxEvent {
  return {
    ...row,
    eventType: normalizeEventType(row.eventType),
    provider: normalizeProvider(row.provider),
    status: normalizeStatus(row.status),
    payloadReference: normalizePayloadReference(row.payloadReference),
  };
}

function canonicalText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} inválido.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 255) throw new Error(`${label} inválido.`);
  return normalized;
}

function normalizeReference(input: EnqueueQuotationOutboxInput): QuotationOutboxPayloadReference {
  return {
    quotationId: canonicalText(input.quotationId, 'Identificador canônico do orçamento'),
    revisionId: canonicalText(input.revisionId, 'Identificador canônico da revisão'),
    businessNumber: canonicalText(input.businessNumber, 'Número canônico do orçamento'),
  };
}

export function deriveOpaqueQuotationOutboxIdempotencyKey(
  value: unknown,
  fallback: string,
  scope: string,
): string {
  const safeFallback = canonicalText(fallback, 'Chave de idempotência do outbox');
  const safeScope = canonicalText(scope, 'Escopo da chave de idempotência');
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    return safeFallback;
  }
  if (typeof value !== 'string' || value.length > 512) {
    throw new Error('Chave de idempotência externa inválida.');
  }
  return `client:${createHash('sha256').update(`${safeScope}\u0000${value}`, 'utf8').digest('hex')}`;
}

function normalizeIdempotencyKey(
  input: EnqueueQuotationOutboxInput,
  reference: QuotationOutboxPayloadReference
): string {
  const explicit = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  const key = explicit || `${input.eventType}:${input.provider}:${reference.quotationId}:${reference.revisionId}`;
  if (!key || key.length > MAX_IDEMPOTENCY_LENGTH) {
    throw new Error('Chave de idempotência do outbox inválida.');
  }
  return key;
}

function errorClass(error: unknown): string {
  if (error && typeof error === 'object') {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim()) return name.trim().slice(0, 128);
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) return code.trim().slice(0, 128);
  }
  return typeof error === 'string' && error.trim() ? 'ProviderError' : 'Error';
}

function sameReference(
  existing: QuotationOutboxEvent,
  expected: {
    eventType: QuotationOutboxEventType;
    provider: QuotationOutboxProvider;
    aggregateId: string;
    payloadReference: QuotationOutboxPayloadReference;
  },
): boolean {
  return existing.eventType === expected.eventType
    && existing.provider === expected.provider
    && existing.aggregateId === expected.aggregateId
    && existing.payloadReference.quotationId === expected.payloadReference.quotationId
    && existing.payloadReference.revisionId === expected.payloadReference.revisionId
    && existing.payloadReference.businessNumber === expected.payloadReference.businessNumber;
}

function assertSameIdempotentEvent(
  existing: QuotationOutboxEvent,
  expected: {
    eventType: QuotationOutboxEventType;
    provider: QuotationOutboxProvider;
    aggregateId: string;
    payloadReference: QuotationOutboxPayloadReference;
  },
  idempotencyKey: string,
): QuotationOutboxEvent {
  if (!sameReference(existing, expected)) {
    throw new QuotationOutboxIdempotencyConflictError(idempotencyKey);
  }
  return existing;
}

function providerMessageId(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, 255) : null;
}

function retryDelay(attempts: number, baseMs: number, maxMs: number): number {
  const exponent = Math.max(0, Math.min(attempts - 1, 30));
  return Math.min(maxMs, baseMs * 2 ** exponent);
}

function duePredicate(now: Date) {
  return and(
    or(
      and(
        or(eq(quotationOutboxEvents.status, 'pending'), eq(quotationOutboxEvents.status, 'retry')),
        lte(quotationOutboxEvents.nextAttemptAt, now),
      ),
      and(
        eq(quotationOutboxEvents.status, 'processing'),
        lte(quotationOutboxEvents.leaseExpiresAt, now),
      ),
    ),
    or(isNull(quotationOutboxEvents.leaseExpiresAt), lte(quotationOutboxEvents.leaseExpiresAt, now)),
  );
}

async function selectById(
  database: OutboxDatabase,
  id: string,
): Promise<QuotationOutboxEvent | null> {
  const [row] = await database
    .select()
    .from(quotationOutboxEvents)
    .where(eq(quotationOutboxEvents.id, id))
    .limit(1);
  return row ? asEvent(row) : null;
}

/**
 * Insert an event while the aggregate transaction is open. `onConflictDoNothing`
 * is the idempotency guard: retries observe the original event rather than
 * creating a second provider effect.
 */
export async function enqueueQuotationOutboxEvent(
  database: OutboxDatabase,
  input: EnqueueQuotationOutboxInput,
  options: Pick<QuotationOutboxRepositoryOptions, 'idFactory' | 'now'> = {},
): Promise<QuotationOutboxEvent> {
  const eventType = normalizeEventType(input.eventType);
  const provider = normalizeProvider(input.provider);
  const reference = normalizeReference(input);
  const idempotencyKey = normalizeIdempotencyKey(
    { ...input, eventType, provider },
    reference,
  );
  const now = validDate(input.now || options.now?.(), new Date());
  const id = options.idFactory?.() || randomUUID();
  if (!id || id.length > 255) throw new Error('Identificador do evento inválido.');

  const inserted = await database
    .insert(quotationOutboxEvents)
    .values({
      id,
      eventType,
      provider,
      aggregateType: 'quotation',
      aggregateId: reference.quotationId,
      payloadReference: reference,
      idempotencyKey,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: quotationOutboxEvents.idempotencyKey })
    .returning();
  if (inserted[0]) return asEvent(inserted[0]);

  const [existing] = await database
    .select()
    .from(quotationOutboxEvents)
    .where(eq(quotationOutboxEvents.idempotencyKey, idempotencyKey))
    .limit(1);
  if (!existing) throw new Error('Evento idempotente não pôde ser recuperado.');
  return assertSameIdempotentEvent(
    asEvent(existing),
    {
      eventType,
      provider,
      aggregateId: reference.quotationId,
      payloadReference: reference,
    },
    idempotencyKey,
  );
}

/**
 * Sent events are accepted only for a quotation/revision pair owned by the
 * same PostgreSQL aggregate. This prevents a caller from attaching a send
 * acknowledgement to another customer's revision or to a Frappe-only ID.
 */
export async function enqueueQuotationSentEvent(
  database: OutboxDatabase,
  input: Omit<EnqueueQuotationOutboxInput, 'eventType'> & { eventType?: 'quotation.sent' },
): Promise<QuotationOutboxEvent> {
  const quotationId = canonicalText(input.quotationId, 'Identificador canônico do orçamento');
  const revisionId = canonicalText(input.revisionId, 'Identificador canônico da revisão');
  const businessNumber = canonicalText(input.businessNumber, 'Número canônico do orçamento');
  const [owned] = await database
    .select({
      quotationId: quotations.id,
      revisionId: quoteRevisions.id,
      businessNumber: quotations.businessNumber,
    })
    .from(quotations)
    .innerJoin(quoteRevisions, eq(quoteRevisions.quotationId, quotations.id))
    .where(and(
      eq(quotations.id, quotationId),
      eq(quoteRevisions.id, revisionId),
      eq(quotations.businessNumber, businessNumber),
    ))
    .limit(1);
  if (!owned) throw new QuotationOutboxOwnershipError();
  return enqueueQuotationOutboxEvent(database, {
    ...input,
    eventType: 'quotation.sent',
    quotationId: owned.quotationId,
    revisionId: owned.revisionId,
    businessNumber: owned.businessNumber,
  });
}

export function createPostgresQuotationOutboxRepository(
  getDb: () => AppDatabase = getDatabase,
  options: QuotationOutboxRepositoryOptions = {},
): QuotationOutboxRepository {
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || randomUUID;
  const retryBaseMs = boundedPositive(options.retryBaseMs, DEFAULT_RETRY_BASE_MS, 60 * 60 * 1_000);
  const retryMaxMs = boundedPositive(options.retryMaxMs, DEFAULT_RETRY_MAX_MS, 24 * 60 * 60 * 1_000);
  const maxAttempts = boundedPositive(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 100);

  const enqueue = (input: EnqueueQuotationOutboxInput, transaction?: OutboxDatabase) =>
    enqueueQuotationOutboxEvent(transaction || getDb(), input, { idFactory, now });

  const claimDueEvents = async ({ owner, limit, leaseMs, now: requestedNow }: ClaimDueOutboxOptions) => {
    const leaseOwner = normalizeOwner(owner);
    const batchSize = boundedPositive(limit, 10, MAX_BATCH_SIZE);
    const duration = boundedPositive(leaseMs, DEFAULT_LEASE_MS, MAX_LEASE_MS);
    const current = validDate(requestedNow, now());
    return getDb().transaction(async (tx) => {
      const candidates = await tx
        .select()
        .from(quotationOutboxEvents)
        .where(duePredicate(current))
        .orderBy(asc(quotationOutboxEvents.nextAttemptAt), asc(quotationOutboxEvents.createdAt))
        .for('update', { skipLocked: true })
        .limit(batchSize);
      const claimed: QuotationOutboxEvent[] = [];
      for (const candidate of candidates) {
        const [row] = await tx
          .update(quotationOutboxEvents)
          .set({
            status: 'processing',
            leaseOwner,
            leaseExpiresAt: new Date(current.getTime() + duration),
            updatedAt: current,
          })
          .where(and(eq(quotationOutboxEvents.id, candidate.id), duePredicate(current)))
          .returning();
        if (row) claimed.push(asEvent(row));
      }
      return claimed;
    });
  };

  const markDelivered = async (
    id: string,
    owner: string,
    messageId?: string | null,
    requestedNow?: Date,
  ) => {
    const leaseOwner = normalizeOwner(owner);
    const current = validDate(requestedNow, now());
    const [row] = await getDb()
      .update(quotationOutboxEvents)
      .set({
        status: 'delivered',
        leaseOwner: null,
        leaseExpiresAt: null,
        providerMessageId: providerMessageId(messageId),
        deliveredAt: current,
        updatedAt: current,
      })
      .where(
        and(
          eq(quotationOutboxEvents.id, id),
          eq(quotationOutboxEvents.status, 'processing'),
          eq(quotationOutboxEvents.leaseOwner, leaseOwner),
          // A worker may only acknowledge while its lease is still valid.
          or(isNull(quotationOutboxEvents.leaseExpiresAt), gt(quotationOutboxEvents.leaseExpiresAt, current)),
        ),
      )
      .returning();
    return row ? asEvent(row) : null;
  };

  const markFailed = async (id: string, owner: string, error: unknown, requestedNow?: Date) => {
    const leaseOwner = normalizeOwner(owner);
    const current = validDate(requestedNow, now());
    const existing = await selectById(getDb(), id);
    if (
      !existing ||
      existing.status !== 'processing' ||
      existing.leaseOwner !== leaseOwner ||
      (existing.leaseExpiresAt && existing.leaseExpiresAt.getTime() < current.getTime())
    ) {
      return null;
    }
    const attempts = existing.attempts + 1;
    const dead = attempts >= maxAttempts;
    const nextAttemptAt = dead
      ? current
      : new Date(current.getTime() + retryDelay(attempts, retryBaseMs, retryMaxMs));
    const [row] = await getDb()
      .update(quotationOutboxEvents)
      .set({
        status: dead ? 'dead_letter' : 'retry',
        attempts,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt,
        lastErrorClass: errorClass(error),
        updatedAt: current,
      })
      .where(
        and(
          eq(quotationOutboxEvents.id, id),
          eq(quotationOutboxEvents.status, 'processing'),
          eq(quotationOutboxEvents.leaseOwner, leaseOwner),
          or(isNull(quotationOutboxEvents.leaseExpiresAt), gt(quotationOutboxEvents.leaseExpiresAt, current)),
        ),
      )
      .returning();
    return row ? asEvent(row) : null;
  };

  return {
    enqueue,
    enqueueInTransaction: (transaction, input) => enqueue(input, transaction),
    claimDueEvents,
    markDelivered,
    markFailed,
    get: (id) => selectById(getDb(), id),
    list: async () => {
      const rows = await getDb()
        .select()
        .from(quotationOutboxEvents)
        .orderBy(asc(quotationOutboxEvents.createdAt));
      return rows.map(asEvent);
    },
  };
}

/**
 * Deterministic in-memory implementation used by unit tests and local worker
 * probes. It mirrors the SQL repository's lease and retry rules, including
 * idempotency, so tests do not need a PostgreSQL server to exercise safety.
 */
export class InMemoryQuotationOutboxRepository implements QuotationOutboxRepository {
  private readonly events = new Map<string, QuotationOutboxEvent>();
  private readonly byKey = new Map<string, string>();
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly maxAttempts: number;

  constructor(options: QuotationOutboxRepositoryOptions = {}) {
    this.now = options.now || (() => new Date());
    this.idFactory = options.idFactory || randomUUID;
    this.retryBaseMs = boundedPositive(options.retryBaseMs, DEFAULT_RETRY_BASE_MS, 60 * 60 * 1_000);
    this.retryMaxMs = boundedPositive(options.retryMaxMs, DEFAULT_RETRY_MAX_MS, 24 * 60 * 60 * 1_000);
    this.maxAttempts = boundedPositive(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 100);
  }

  async enqueue(input: EnqueueQuotationOutboxInput): Promise<QuotationOutboxEvent> {
    const eventType = normalizeEventType(input.eventType);
    const provider = normalizeProvider(input.provider);
    const reference = normalizeReference(input);
    const key = normalizeIdempotencyKey({ ...input, eventType, provider }, reference);
    const existingId = this.byKey.get(key);
    if (existingId) {
      const existing = this.events.get(existingId)!;
      return assertSameIdempotentEvent(
        existing,
        {
          eventType,
          provider,
          aggregateId: reference.quotationId,
          payloadReference: reference,
        },
        key,
      );
    }
    const current = validDate(input.now, this.now());
    const id = this.idFactory();
    const event = {
      id,
      eventType,
      provider,
      aggregateType: 'quotation',
      aggregateId: reference.quotationId,
      payloadReference: reference,
      idempotencyKey: key,
      status: 'pending',
      attempts: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: current,
      lastErrorClass: null,
      providerMessageId: null,
      createdAt: current,
      updatedAt: current,
      deliveredAt: null,
    } as QuotationOutboxEvent;
    this.events.set(id, event);
    this.byKey.set(key, id);
    return event;
  }

  async enqueueInTransaction(_transaction: OutboxDatabase, input: EnqueueQuotationOutboxInput) {
    return this.enqueue(input);
  }

  /**
   * Transaction-aware seam for aggregate tests and local probes.
   * Failed callbacks restore both idempotency indexes and event rows.
   */
  async transaction<T>(callback: (transaction: OutboxDatabase) => Promise<T>): Promise<T> {
    const events = new Map(
      [...this.events.entries()].map(([id, event]) => [id, { ...event, payloadReference: { ...event.payloadReference } }]),
    );
    const byKey = new Map(this.byKey);
    try {
      return await callback(this as unknown as OutboxDatabase);
    } catch (error) {
      this.events.clear();
      for (const [id, event] of events) this.events.set(id, event);
      this.byKey.clear();
      for (const [key, id] of byKey) this.byKey.set(key, id);
      throw error;
    }
  }

  async claimDueEvents({ owner, limit, leaseMs, now: requestedNow }: ClaimDueOutboxOptions) {
    const leaseOwner = normalizeOwner(owner);
    const batchSize = boundedPositive(limit, 10, MAX_BATCH_SIZE);
    const duration = boundedPositive(leaseMs, DEFAULT_LEASE_MS, MAX_LEASE_MS);
    const current = validDate(requestedNow, this.now());
    const claimed: QuotationOutboxEvent[] = [];
    for (const event of this.events.values()) {
      const due =
        ((event.status === 'pending' || event.status === 'retry') && event.nextAttemptAt <= current) ||
        (event.status === 'processing' && !!event.leaseExpiresAt && event.leaseExpiresAt <= current);
      const leaseFree = !event.leaseExpiresAt || event.leaseExpiresAt <= current;
      if (!due || !leaseFree || claimed.length >= batchSize) continue;
      event.status = 'processing';
      event.leaseOwner = leaseOwner;
      event.leaseExpiresAt = new Date(current.getTime() + duration);
      event.updatedAt = current;
      claimed.push({ ...event });
    }
    return claimed;
  }

  async markDelivered(id: string, owner: string, messageId?: string | null, requestedNow?: Date) {
    const leaseOwner = normalizeOwner(owner);
    const current = validDate(requestedNow, this.now());
    const event = this.events.get(id);
    if (
      !event ||
      event.status !== 'processing' ||
      event.leaseOwner !== leaseOwner ||
      (event.leaseExpiresAt && event.leaseExpiresAt <= current)
    ) return null;
    event.status = 'delivered';
    event.leaseOwner = null;
    event.leaseExpiresAt = null;
    event.providerMessageId = providerMessageId(messageId);
    event.deliveredAt = current;
    event.updatedAt = current;
    return { ...event };
  }

  async markFailed(id: string, owner: string, error: unknown, requestedNow?: Date) {
    const leaseOwner = normalizeOwner(owner);
    const current = validDate(requestedNow, this.now());
    const event = this.events.get(id);
    if (
      !event ||
      event.status !== 'processing' ||
      event.leaseOwner !== leaseOwner ||
      (event.leaseExpiresAt && event.leaseExpiresAt <= current)
    ) return null;
    event.attempts += 1;
    const dead = event.attempts >= this.maxAttempts;
    event.status = dead ? 'dead_letter' : 'retry';
    event.leaseOwner = null;
    event.leaseExpiresAt = null;
    event.nextAttemptAt = dead
      ? current
      : new Date(current.getTime() + retryDelay(event.attempts, this.retryBaseMs, this.retryMaxMs));
    event.lastErrorClass = errorClass(error);
    event.updatedAt = current;
    return { ...event };
  }

  async get(id: string) {
    const event = this.events.get(id);
    return event ? { ...event } : null;
  }

  async list() {
    return [...this.events.values()].map((event) => ({ ...event }));
  }
}

export const createQuotationOutboxRepository = createPostgresQuotationOutboxRepository;
