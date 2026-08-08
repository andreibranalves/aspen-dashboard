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

export interface QuotationOutboxWorkerOptions {
  repository?: QuotationOutboxRepository;
  adapters: Record<QuotationOutboxProvider, QuotationOutboxProviderAdapter>;
  owner: string;
  limit?: number;
  leaseMs?: number;
  now?: () => Date;
}

export interface QuotationOutboxWorkerResult {
  claimed: number;
  delivered: number;
  retried: number;
  deadLettered: number;
  leaseLost: number;
}

function contextFor(event: QuotationOutboxEvent): QuotationOutboxProviderContext {
  return {
    eventType: event.eventType,
    provider: event.provider,
    reference: {
      quotationId: event.payloadReference.quotationId,
      revisionId: event.payloadReference.revisionId,
      businessNumber: event.payloadReference.businessNumber,
    },
    idempotencyKey: event.idempotencyKey,
  };
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
  const current = options.now?.() || new Date();
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
      const delivery = accepted(event.provider, await provider.deliver(contextFor(event)));
      const delivered = await repository.markDelivered(
        event.id,
        options.owner,
        delivery.providerMessageId,
        options.now?.() || new Date(),
      );
      if (delivered) result.delivered += 1;
      else result.leaseLost += 1;
    } catch (error) {
      const failed = await repository.markFailed(
        event.id,
        options.owner,
        error,
        options.now?.() || new Date(),
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
