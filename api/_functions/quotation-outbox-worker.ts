import {
  createPostgresQuotationOutboxRepository,
  type QuotationOutboxEvent,
  type QuotationOutboxProvider,
  type QuotationOutboxRepository,
  type QuotationOutboxPayloadReference,
} from '../_db/quotation-outbox-repository.js';

/**
 * Provider adapters receive canonical identifiers only.  They may resolve a
 * revision/client snapshot inside their own trusted boundary, but the outbox
 * row and this contract never carry customer PII, provider secrets or raw
 * provider payloads.
 */
export interface QuotationOutboxProviderContext {
  eventType: QuotationOutboxEvent['eventType'];
  provider: QuotationOutboxProvider;
  reference: QuotationOutboxPayloadReference;
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface QuotationOutboxDeliveryResult {
  /** Resolving means the provider accepted the request, not merely that it was attempted. */
  accepted?: boolean;
  providerMessageId?: string | null;
}

export type QuotationOutboxProviderOperation = (
  context: QuotationOutboxProviderContext,
) => Promise<QuotationOutboxDeliveryResult | void>;

export interface QuotationOutboxProviderAdapter {
  readonly provider: QuotationOutboxProvider;
  deliver: QuotationOutboxProviderOperation;
}

export interface QuotationOutboxProviderOperations {
  n8n?: QuotationOutboxProviderOperation;
  evolution?: QuotationOutboxProviderOperation;
  crm?: QuotationOutboxProviderOperation;
}

export interface QuotationOutboxProviderConfig {
  n8nUrl?: string;
  evolutionUrl?: string;
  crmUrl?: string;
  n8nToken?: string;
  evolutionToken?: string;
  crmToken?: string;
  fetcher?: typeof fetch;
}

export class QuotationOutboxProviderUnavailableError extends Error {
  constructor(provider: QuotationOutboxProvider) {
    super(`Adaptador de outbox não configurado: ${provider}`);
    this.name = 'QuotationOutboxProviderUnavailableError';
  }
}

export class QuotationOutboxProviderRejectedError extends Error {
  constructor(provider: QuotationOutboxProvider) {
    super(`O provedor rejeitou o evento de outbox: ${provider}`);
    this.name = 'QuotationOutboxProviderRejectedError';
  }
}

export class QuotationOutboxProviderTimeoutError extends Error {
  readonly provider: QuotationOutboxProvider;
  readonly timeoutMs: number;

  constructor(provider: QuotationOutboxProvider, timeoutMs: number) {
    super(`Tempo limite do adaptador de outbox excedido: ${provider}.`);
    this.name = 'QuotationOutboxProviderTimeoutError';
    this.provider = provider;
    this.timeoutMs = timeoutMs;
  }
}

export class QuotationOutboxLeaseExpiredError extends Error {
  constructor(provider: QuotationOutboxProvider | 'unknown') {
    super(`Lease do adaptador de outbox expirou antes da entrega: ${provider}.`);
    this.name = 'QuotationOutboxLeaseExpiredError';
  }
}

function adapter(
  provider: QuotationOutboxProvider,
  operation: QuotationOutboxProviderOperation | undefined,
): QuotationOutboxProviderAdapter {
  return {
    provider,
    deliver: operation || (async () => {
      throw new QuotationOutboxProviderUnavailableError(provider);
    }),
  };
}

/**
 * Narrow seams for the existing N8N, Evolution and CRM clients.  Wiring is
 * explicit so this worker cannot accidentally send a provider request with a
 * raw outbox payload or a secret copied into PostgreSQL.
 */
export function createQuotationOutboxProviderAdapters(
  operations: QuotationOutboxProviderOperations,
): Record<QuotationOutboxProvider, QuotationOutboxProviderAdapter> {
  return {
    n8n: adapter('n8n', operations.n8n),
    evolution: adapter('evolution', operations.evolution),
    crm: adapter('crm', operations.crm),
  };
}

function configuredUrl(value: string | undefined, provider: QuotationOutboxProvider): string {
  if (!value) throw new QuotationOutboxProviderUnavailableError(provider);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`URL do adaptador de outbox inválida: ${provider}`);
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(`URL do adaptador de outbox insegura: ${provider}`);
  }
  return parsed.toString();
}

function configuredOperation(
  provider: QuotationOutboxProvider,
  url: string | undefined,
  token: string | undefined,
  fetcher: typeof fetch,
): QuotationOutboxProviderOperation {
  return async (context) => {
    const endpoint = configuredUrl(url, provider);
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: context.signal,
      body: JSON.stringify({
        event_type: context.eventType,
        provider: context.provider,
        quotation_id: context.reference.quotationId,
        revision_id: context.reference.revisionId,
        business_number: context.reference.businessNumber,
        idempotency_key: context.idempotencyKey,
      }),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) throw new Error(`Adaptador ${provider} rejeitou o evento (${response.status}).`);
    const messageId = body && [body.provider_message_id, body.message_id, body.id]
      .find((value): value is string => typeof value === 'string' && Boolean(value.trim()));
    return { accepted: true, providerMessageId: messageId || null };
  };
}

/**
 * Deployable default wiring for a small provider bridge/webhook per adapter.
 * Only canonical references are sent; tokens stay in process environment.
 */
export function createConfiguredQuotationOutboxProviderAdapters(
  config: QuotationOutboxProviderConfig,
): Record<QuotationOutboxProvider, QuotationOutboxProviderAdapter> {
  const fetcher = config.fetcher || fetch;
  return createQuotationOutboxProviderAdapters({
    n8n: configuredOperation('n8n', config.n8nUrl, config.n8nToken, fetcher),
    evolution: configuredOperation('evolution', config.evolutionUrl, config.evolutionToken, fetcher),
    crm: configuredOperation('crm', config.crmUrl, config.crmToken, fetcher),
  });
}

export function quotationOutboxConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): QuotationOutboxProviderConfig {
  return {
    n8nUrl: env.OUTBOX_N8N_URL || env.N8N_OUTBOX_WEBHOOK_URL,
    evolutionUrl: env.OUTBOX_EVOLUTION_URL,
    crmUrl: env.OUTBOX_CRM_URL,
    n8nToken: env.OUTBOX_N8N_TOKEN,
    evolutionToken: env.OUTBOX_EVOLUTION_TOKEN,
    crmToken: env.OUTBOX_CRM_TOKEN,
  };
}

export interface QuotationOutboxWorkerOptions {
  repository?: QuotationOutboxRepository;
  adapters: Record<QuotationOutboxProvider, QuotationOutboxProviderAdapter>;
  owner: string;
  limit?: number;
  leaseMs?: number;
  /** Must remain below leaseMs so timeout failures release before reclaim. */
  providerTimeoutMs?: number;
  now?: () => Date;
}

export interface QuotationOutboxWorkerResult {
  claimed: number;
  delivered: number;
  retried: number;
  deadLettered: number;
  leaseLost: number;
}

function contextFor(
  event: QuotationOutboxEvent,
  signal?: AbortSignal,
): QuotationOutboxProviderContext {
  return {
    eventType: event.eventType,
    provider: event.provider,
    reference: {
      quotationId: event.payloadReference.quotationId,
      revisionId: event.payloadReference.revisionId,
      businessNumber: event.payloadReference.businessNumber,
    },
    idempotencyKey: event.idempotencyKey,
    ...(signal ? { signal } : {}),
  };
}

const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
const MIN_REMAINING_LEASE_MS = 2;

function requestedProviderTimeoutMs(options: QuotationOutboxWorkerOptions): number {
  return Number.isFinite(options.providerTimeoutMs) && (options.providerTimeoutMs as number) > 0
    ? Math.floor(options.providerTimeoutMs as number)
    : DEFAULT_PROVIDER_TIMEOUT_MS;
}

/**
 * Calculate a timeout from the event's own lease after the batch has been
 * claimed. A one millisecond guard keeps the timer strictly before expiry;
 * events with no safe window are failed without invoking a provider.
 */
export function quotationOutboxProviderTimeoutMs(
  leaseExpiresAt: Date | null | undefined,
  now: Date,
  requestedMs: number = DEFAULT_PROVIDER_TIMEOUT_MS,
): number {
  const remainingMs = leaseExpiresAt instanceof Date
    ? leaseExpiresAt.getTime() - now.getTime()
    : Number.NaN;
  if (!Number.isFinite(remainingMs) || remainingMs < MIN_REMAINING_LEASE_MS) {
    throw new QuotationOutboxLeaseExpiredError('unknown');
  }
  const requested = Number.isFinite(requestedMs) && requestedMs > 0
    ? Math.floor(requestedMs)
    : DEFAULT_PROVIDER_TIMEOUT_MS;
  return Math.max(1, Math.min(requested, Math.floor(remainingMs) - 1));
}

async function invokeProviderWithTimeout(
  provider: QuotationOutboxProviderAdapter,
  event: QuotationOutboxEvent,
  now: Date,
  requestedMs: number,
): Promise<QuotationOutboxDeliveryResult | void> {
  const timeoutMs = quotationOutboxProviderTimeoutMs(event.leaseExpiresAt, now, requestedMs);
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new QuotationOutboxProviderTimeoutError(event.provider, timeoutMs));
    }, timeoutMs);
  });
  const invocation = provider.deliver(contextFor(event, controller.signal));
  try {
    return await Promise.race([invocation, timeout]);
  } catch (error) {
    if (timedOut) throw new QuotationOutboxProviderTimeoutError(event.provider, timeoutMs);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function accepted(
  provider: QuotationOutboxProvider,
  result: QuotationOutboxDeliveryResult | void,
): QuotationOutboxDeliveryResult {
  if (result && result.accepted === false) {
    throw new QuotationOutboxProviderRejectedError(provider);
  }
  return result || {};
}

/**
 * Process one bounded batch.  Claiming is lease-protected in the repository;
 * provider failures only change outbox state, never the saved quotation.
 */
export async function processQuotationOutbox(
  options: QuotationOutboxWorkerOptions,
): Promise<QuotationOutboxWorkerResult> {
  const repository = options.repository || createPostgresQuotationOutboxRepository();
  const clock = options.now || (() => new Date());
  const current = clock();
  const requestedTimeoutMs = requestedProviderTimeoutMs(options);
  const events = await repository.claimDueEvents({
    owner: options.owner,
    limit: options.limit,
    leaseMs: options.leaseMs,
    now: current,
  });
  const result: QuotationOutboxWorkerResult = {
    claimed: events.length,
    delivered: 0,
    retried: 0,
    deadLettered: 0,
    leaseLost: 0,
  };

  for (const event of events) {
    try {
      const provider = options.adapters[event.provider];
      if (!provider || provider.provider !== event.provider) {
        throw new QuotationOutboxProviderUnavailableError(event.provider);
      }
      const delivery = accepted(
        event.provider,
        await invokeProviderWithTimeout(provider, event, clock(), requestedTimeoutMs),
      );
      const delivered = await repository.markDelivered(
        event.id,
        options.owner,
        delivery.providerMessageId,
        clock(),
      );
      if (delivered) result.delivered += 1;
      else result.leaseLost += 1;
    } catch (error) {
      const failed = await repository.markFailed(
        event.id,
        options.owner,
        error,
        clock(),
      );
      if (!failed) {
        result.leaseLost += 1;
      } else if (failed.status === 'dead_letter') {
        result.deadLettered += 1;
      } else {
        result.retried += 1;
      }
    }
  }

  return result;
}

export async function runQuotationOutboxWorker(
  options: QuotationOutboxWorkerOptions,
): Promise<QuotationOutboxWorkerResult> {
  return processQuotationOutbox(options);
}
