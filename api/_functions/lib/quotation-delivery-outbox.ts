import {
  createPostgresQuotationDeliveryOutboxRepository,
  type ClaimedDeliveryStep,
  type DeliveryAggregate,
  type DeliveryIdentity,
  type DeliveryListFilters,
  type DeliveryListResult,
  type EnqueueDeliveryRecord,
  type QuotationDeliveryOutboxRepository,
  type ResolveDeliveryInput,
} from '../../_db/quotation-delivery-outbox-repository.js';
import {
  createPostgresQuotationDeliveryRepository,
  type PreparedDeliveryDocument,
} from '../../_db/quotation-delivery-repository.js';
import { createQuotationTemplateRepository } from '../../_db/quotation-template-repository.js';
import {
  createDeliveryPlan,
  type DeliveryPlan,
  type DeliveryPlanInput,
} from './quotation-delivery-plan.js';
import {
  EvolutionTransportError,
  sendFrozenStep,
  type EvolutionAccepted,
  type EvolutionTransportDependencies,
} from './evolution-transport.js';
import type { EvolutionReceiptStatus, TransportFailureKind } from './quotation-delivery-state.js';

export const DELIVERY_LEASE_MS = 90_000;
export const RECONCILIATION_WAIT_MS = 120_000;
export const PROVIDER_DELAY_WARNING_MS = 86_400_000;
export const DEFAULT_PROCESS_DUE_LIMIT = 20;
export const MAX_PROCESS_DUE_LIMIT = 50;

const RECEIPT_STATUSES: readonly EvolutionReceiptStatus[] = [
  'ERROR',
  'PENDING',
  'SERVER_ACK',
  'DELIVERY_ACK',
  'READ',
  'PLAYED',
];
const FAILURE_KINDS: readonly TransportFailureKind[] = [
  'transient_pre_transport',
  'permanent_pre_transport',
  'ambiguous',
];

const PUBLIC_ERRORS: Record<TransportFailureKind, string> = {
  transient_pre_transport: 'Falha transitória antes do transporte. Tente novamente.',
  permanent_pre_transport:
    'O envio foi rejeitado antes do transporte. Corrija os dados e tente novamente.',
  ambiguous: 'O resultado do transporte requer reconciliação. Não reenvie automaticamente.',
};

const PDF_PUBLIC_ERRORS: Record<'transient' | 'permanent', string> = {
  transient: 'PDF indisponível. Tentar novamente.',
  permanent: 'A revisão do orçamento não está disponível para envio.',
};

type DeliveryEnqueueInput = DeliveryIdentity & {
  quotationId?: string;
  businessNumber?: string;
};
type DeliveryPlanner = (input: DeliveryPlanInput) => Promise<DeliveryPlan>;
type DeliveryDocumentPreparer = (revisionId: string) => Promise<PreparedDeliveryDocument>;
type QuotationIdentityResolver = (
  revisionId: string
) => Promise<{ quotationId: string; businessNumber?: string } | null>;
type DeliveryTransport = (
  input: Parameters<typeof sendFrozenStep>[0],
  dependencies?: EvolutionTransportDependencies
) => Promise<EvolutionAccepted>;

export interface DeliveryLogEvent {
  deliveryId: string;
  stepId: string;
  state: DeliveryAggregate['state'];
  errorCode: string;
  duration: number;
}

export type DeliveryLogger =
  | ((event: DeliveryLogEvent) => void)
  | {
      info?: (event: DeliveryLogEvent) => void;
      warn?: (event: DeliveryLogEvent) => void;
      error?: (event: DeliveryLogEvent) => void;
    };

export interface QuotationDeliveryModuleDependencies {
  repository?: QuotationDeliveryOutboxRepository;
  repositoryFactory?: () => QuotationDeliveryOutboxRepository;
  planner?: DeliveryPlanner;
  plan?: DeliveryPlanner;
  createPlan?: DeliveryPlanner;
  prepareDeliveryDocument?: DeliveryDocumentPreparer;
  prepareDocument?: DeliveryDocumentPreparer;
  preparePdf?: DeliveryDocumentPreparer;
  pdfRenderer?: DeliveryDocumentPreparer;
  transport?: DeliveryTransport;
  sendStep?: DeliveryTransport;
  transportDependencies?: EvolutionTransportDependencies;
  evolutionTransport?: EvolutionTransportDependencies;
  resolveQuotation?: QuotationIdentityResolver;
  now?: () => Date;
  instance?: string;
  logger?: DeliveryLogger;
}

export interface EvolutionMessageEvent {
  instance: string;
  providerMessageId: string;
  fromMe: true;
  status: EvolutionReceiptStatus;
}

export interface QuotationDeliveryModule {
  enqueue(input: DeliveryIdentity): Promise<DeliveryAggregate>;
  process(deliveryId?: string): Promise<DeliveryAggregate | null>;
  processDue(limit: number): Promise<{ processed: number; remaining: boolean }>;
  applyEvolutionEvent(event: EvolutionMessageEvent): Promise<DeliveryAggregate | null>;
  get(input: {
    deliveryId?: string;
    identity?: DeliveryIdentity;
  }): Promise<DeliveryAggregate | null>;
  list(filters: DeliveryListFilters): Promise<DeliveryListResult>;
  resolve(input: ResolveDeliveryInput): Promise<DeliveryAggregate>;
}

export class QuotationDeliveryModuleInputError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'QuotationDeliveryModuleInputError';
  }
}

class DeliveryStepFailure extends Error {
  constructor(
    readonly kind: TransportFailureKind,
    readonly code: string,
    readonly publicError: string
  ) {
    super(publicError);
    this.name = 'DeliveryStepFailure';
  }
}

interface ProcessResult {
  aggregate: DeliveryAggregate | null;
  claims: number;
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function safeCode(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const code = value.trim();
  return /^[A-Za-z0-9._:-]{1,120}$/.test(code) ? code : fallback;
}

function transportFailure(error: unknown): {
  kind: TransportFailureKind;
  code: string;
  publicError: string;
} {
  if (error instanceof EvolutionTransportError) {
    return {
      kind: error.kind,
      code: safeCode(error.code, 'EVOLUTION_UNKNOWN'),
      publicError: PUBLIC_ERRORS[error.kind],
    };
  }
  if (error instanceof DeliveryStepFailure) {
    return { kind: error.kind, code: error.code, publicError: error.publicError };
  }
  if (error && typeof error === 'object') {
    const candidate = error as {
      kind?: unknown;
      code?: unknown;
      publicError?: unknown;
    };
    if (FAILURE_KINDS.includes(candidate.kind as TransportFailureKind)) {
      const kind = candidate.kind as TransportFailureKind;
      return {
        kind,
        code: safeCode(candidate.code, 'EVOLUTION_UNKNOWN'),
        publicError: PUBLIC_ERRORS[kind],
      };
    }
  }
  return {
    kind: 'ambiguous',
    code: 'EVOLUTION_UNKNOWN',
    publicError: PUBLIC_ERRORS.ambiguous,
  };
}

function isPermanentRevisionFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; statusCode?: unknown; message?: unknown };
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  const normalized = `${name} ${message}`.toLocaleLowerCase('pt-BR');
  if (candidate.statusCode === 404 || candidate.statusCode === 409) return true;
  if (/(notfound|inputerror|conflicterror)/i.test(name)) return true;
  return /(revis[aã]o|snapshot).*(vencid|expirad|inv[aá]lid|n[aã]o encontr|indispon[ií]vel)/i.test(
    normalized
  );
}

function documentFailure(error: unknown): DeliveryStepFailure {
  if (error instanceof DeliveryStepFailure) return error;
  if (error instanceof EvolutionTransportError) {
    return new DeliveryStepFailure(
      error.kind,
      safeCode(error.code, 'EVOLUTION_UNKNOWN'),
      PUBLIC_ERRORS[error.kind]
    );
  }
  if (isPermanentRevisionFailure(error)) {
    return new DeliveryStepFailure(
      'permanent_pre_transport',
      'QUOTATION_REVISION_INVALID',
      PDF_PUBLIC_ERRORS.permanent
    );
  }
  return new DeliveryStepFailure(
    'transient_pre_transport',
    'QUOTATION_PDF_RENDER',
    PDF_PUBLIC_ERRORS.transient
  );
}

function normalizedDocument(value: unknown, now: () => Date): PreparedDeliveryDocument {
  const candidate = Buffer.isBuffer(value)
    ? ({ pdf: value } as Partial<PreparedDeliveryDocument>)
    : value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<PreparedDeliveryDocument>)
      : null;
  if (!candidate) {
    throw new DeliveryStepFailure(
      'transient_pre_transport',
      'QUOTATION_PDF_INVALID',
      PDF_PUBLIC_ERRORS.transient
    );
  }
  if (!Buffer.isBuffer(candidate.pdf) || candidate.pdf.length === 0) {
    throw new DeliveryStepFailure(
      'transient_pre_transport',
      'QUOTATION_PDF_INVALID',
      PDF_PUBLIC_ERRORS.transient
    );
  }
  if (
    candidate.pdfSize !== undefined &&
    (!Number.isSafeInteger(candidate.pdfSize) || candidate.pdfSize !== candidate.pdf.length)
  ) {
    throw new DeliveryStepFailure(
      'transient_pre_transport',
      'QUOTATION_PDF_INVALID',
      PDF_PUBLIC_ERRORS.transient
    );
  }
  if (candidate.validUntil !== undefined) {
    if (!validDate(candidate.validUntil)) {
      throw new DeliveryStepFailure(
        'permanent_pre_transport',
        'QUOTATION_REVISION_INVALID',
        PDF_PUBLIC_ERRORS.permanent
      );
    }
    if (now().getTime() >= candidate.validUntil.getTime()) {
      throw new DeliveryStepFailure(
        'permanent_pre_transport',
        'QUOTATION_REVISION_EXPIRED',
        PDF_PUBLIC_ERRORS.permanent
      );
    }
  }
  return {
    pdf: candidate.pdf,
    pdfSize: candidate.pdfSize === candidate.pdf.length ? candidate.pdfSize : candidate.pdf.length,
    pdfSignature: typeof candidate.pdfSignature === 'string' ? candidate.pdfSignature : '',
    validUntil: validDate(candidate.validUntil)
      ? candidate.validUntil
      : new Date(now().getTime() + 1),
  };
}

function validateEvent(event: EvolutionMessageEvent, expectedInstance?: string): void {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new QuotationDeliveryModuleInputError('Evento da Evolution inválido.');
  }
  if (typeof event.instance !== 'string' || !event.instance.trim()) {
    throw new QuotationDeliveryModuleInputError('Instância da Evolution inválida.');
  }
  if (expectedInstance && event.instance !== expectedInstance) {
    throw new QuotationDeliveryModuleInputError('Instância da Evolution inválida.');
  }
  if (typeof event.providerMessageId !== 'string' || !event.providerMessageId.trim()) {
    throw new QuotationDeliveryModuleInputError('Identificador da mensagem inválido.');
  }
  if (event.fromMe !== true) {
    throw new QuotationDeliveryModuleInputError('Evento da Evolution inválido.');
  }
  if (!RECEIPT_STATUSES.includes(event.status)) {
    throw new QuotationDeliveryModuleInputError('Status de recibo inválido.');
  }
}

function validateBatchLimit(value: unknown): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_PROCESS_DUE_LIMIT
  ) {
    throw new QuotationDeliveryModuleInputError('Limite de processamento inválido.');
  }
  return value as number;
}

function logEvent(
  logger: DeliveryLogger | undefined,
  event: DeliveryLogEvent,
  level: 'info' | 'warn' | 'error' = 'info'
): void {
  if (typeof logger === 'function') {
    logger(event);
    return;
  }
  if (logger?.[level]) {
    logger[level]!(event);
    return;
  }
  console.info(JSON.stringify(event));
}

function durationSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function deliveryRecord(plan: DeliveryPlan): EnqueueDeliveryRecord {
  return {
    revisionId: plan.revisionId,
    flowId: plan.flowId,
    phone: plan.phone,
    flowName: plan.flowName,
    steps: plan.steps,
  };
}

export function createQuotationDeliveryModule(
  dependencies: QuotationDeliveryModuleDependencies = {}
): QuotationDeliveryModule {
  const now = dependencies.now || (() => new Date());
  const repository =
    dependencies.repository ||
    dependencies.repositoryFactory?.() ||
    createPostgresQuotationDeliveryOutboxRepository(undefined, {
      now,
      leaseMs: DELIVERY_LEASE_MS,
      reconciliationMs: RECONCILIATION_WAIT_MS,
    });
  const configuredPlanner = dependencies.planner || dependencies.plan || dependencies.createPlan;
  const resolveQuotation =
    dependencies.resolveQuotation ||
    (async (revisionId: string) => {
      const snapshot = await createQuotationTemplateRepository().get(revisionId);
      return snapshot
        ? {
            quotationId: snapshot.quotation.id,
            businessNumber: snapshot.quotation.businessNumber,
          }
        : null;
    });
  const planner: DeliveryPlanner =
    configuredPlanner ||
    (async (input) => {
      const identity = input as DeliveryEnqueueInput;
      const quotation =
        identity.quotationId || identity.businessNumber
          ? {
              quotationId: identity.quotationId,
              businessNumber: identity.businessNumber,
            }
          : await resolveQuotation(input.revisionId);
      if (!quotation?.quotationId && !quotation?.businessNumber) {
        throw new QuotationDeliveryModuleInputError('Orçamento PostgreSQL não encontrado.');
      }
      return createDeliveryPlan({ ...input, ...quotation });
    });
  const configuredTransport = dependencies.transport || dependencies.sendStep;
  const transport: DeliveryTransport = configuredTransport || sendFrozenStep;
  const transportDependencies =
    dependencies.transportDependencies || dependencies.evolutionTransport;
  const logger = dependencies.logger;
  let fallbackDocumentPreparer: DeliveryDocumentPreparer | undefined;
  const documentPreparer =
    dependencies.prepareDeliveryDocument ||
    dependencies.prepareDocument ||
    dependencies.preparePdf ||
    dependencies.pdfRenderer ||
    (() => {
      fallbackDocumentPreparer ||= createPostgresQuotationDeliveryRepository(undefined, {
        now,
      }).prepareDeliveryDocument;
      return fallbackDocumentPreparer;
    })();
  const inFlight = new Map<string, Promise<DeliveryAggregate | null>>();

  async function prepareDocument(
    claimed: ClaimedDeliveryStep
  ): Promise<PreparedDeliveryDocument | undefined> {
    if (claimed.step.snapshot.type !== 'quotation_pdf') return undefined;
    if (claimed.step.snapshot.payload.revisionId !== claimed.delivery.revisionId) {
      throw new DeliveryStepFailure(
        'permanent_pre_transport',
        'QUOTATION_REVISION_MISMATCH',
        PDF_PUBLIC_ERRORS.permanent
      );
    }
    try {
      return normalizedDocument(
        await documentPreparer(claimed.step.snapshot.payload.revisionId),
        now
      );
    } catch (error) {
      throw documentFailure(error);
    }
  }

  async function persistFailure(
    claimed: ClaimedDeliveryStep,
    failure: { kind: TransportFailureKind; code: string; publicError: string }
  ): Promise<DeliveryAggregate> {
    try {
      return await repository.markFailure({
        deliveryId: claimed.delivery.id,
        stepId: claimed.step.id,
        leaseToken: claimed.leaseToken,
        kind: failure.kind,
        code: failure.code,
        publicError: failure.publicError,
      });
    } catch {
      const current = await repository.get(claimed.delivery.id);
      return current || claimed.delivery;
    }
  }

  async function processInternal(
    deliveryId: string | undefined,
    maxClaims = Number.POSITIVE_INFINITY
  ): Promise<ProcessResult> {
    let latest: DeliveryAggregate | null = null;
    let claims = 0;
    while (claims < maxClaims) {
      const claimed = await repository.claim(deliveryId ? { deliveryId } : {});
      if (!claimed) break;
      claims += 1;
      const startedAt = Date.now();
      let accepted: EvolutionAccepted;
      try {
        const document = await prepareDocument(claimed);
        const result = transportDependencies
          ? await transport(
              { phone: claimed.delivery.phone, step: claimed.step.snapshot, document },
              transportDependencies
            )
          : await transport({
              phone: claimed.delivery.phone,
              step: claimed.step.snapshot,
              document,
            });
        if (
          !result ||
          result.accepted !== true ||
          typeof result.providerMessageId !== 'string' ||
          !result.providerMessageId.trim()
        ) {
          throw new EvolutionTransportError(
            'O provedor não confirmou o transporte.',
            'ambiguous',
            'EVOLUTION_MISSING_PROVIDER_ID'
          );
        }
        accepted = result;
      } catch (error) {
        const failure = transportFailure(error);
        latest = await persistFailure(claimed, failure);
        logEvent(
          logger,
          {
            deliveryId: claimed.delivery.id,
            stepId: claimed.step.id,
            state: latest.state,
            errorCode: failure.code,
            duration: durationSince(startedAt),
          },
          'warn'
        );
        break;
      }

      try {
        latest = await repository.markAccepted({
          deliveryId: claimed.delivery.id,
          stepId: claimed.step.id,
          leaseToken: claimed.leaseToken,
          providerMessageId: accepted.providerMessageId,
        });
        logEvent(logger, {
          deliveryId: claimed.delivery.id,
          stepId: claimed.step.id,
          state: latest.state,
          errorCode: 'OK',
          duration: durationSince(startedAt),
        });
      } catch {
        latest = await persistFailure(claimed, {
          kind: 'ambiguous',
          code: 'DELIVERY_ACCEPTANCE_PERSISTENCE',
          publicError: PUBLIC_ERRORS.ambiguous,
        });
        logEvent(
          logger,
          {
            deliveryId: claimed.delivery.id,
            stepId: claimed.step.id,
            state: latest.state,
            errorCode: 'DELIVERY_ACCEPTANCE_PERSISTENCE',
            duration: durationSince(startedAt),
          },
          'error'
        );
        break;
      }
    }

    if (deliveryId && latest === null) latest = await repository.get(deliveryId);
    else if (deliveryId) latest = (await repository.get(deliveryId)) || latest;
    return { aggregate: latest, claims };
  }

  async function process(deliveryId?: string): Promise<DeliveryAggregate | null> {
    if (!deliveryId) return (await processInternal(undefined)).aggregate;
    const running = inFlight.get(deliveryId);
    if (running) return running;
    const task = processInternal(deliveryId).then((result) => result.aggregate);
    inFlight.set(deliveryId, task);
    try {
      return await task;
    } finally {
      if (inFlight.get(deliveryId) === task) inFlight.delete(deliveryId);
    }
  }

  async function enqueue(input: DeliveryEnqueueInput): Promise<DeliveryAggregate> {
    const plan = await planner(input);
    const queued = await repository.enqueue(deliveryRecord(plan));
    return (await process(queued.id)) || queued;
  }

  async function processDue(
    requestedLimit: number
  ): Promise<{ processed: number; remaining: boolean }> {
    const limit = validateBatchLimit(requestedLimit);
    await repository.expireReconciliations(limit);
    let processed = 0;
    while (processed < limit) {
      const result = await processInternal(undefined, 1);
      if (result.claims === 0) {
        return { processed, remaining: false };
      }
      processed += result.claims;
    }
    return { processed, remaining: true };
  }

  async function applyEvolutionEvent(
    event: EvolutionMessageEvent
  ): Promise<DeliveryAggregate | null> {
    validateEvent(event, dependencies.instance);
    return repository.applyReceipt({
      providerMessageId: event.providerMessageId,
      status: event.status,
    });
  }

  async function get(input: {
    deliveryId?: string;
    identity?: DeliveryIdentity;
  }): Promise<DeliveryAggregate | null> {
    const hasDeliveryId = typeof input?.deliveryId === 'string' && input.deliveryId.trim() !== '';
    const hasIdentity = Boolean(input?.identity);
    if (hasDeliveryId === hasIdentity) {
      throw new QuotationDeliveryModuleInputError(
        'Identificador da entrega ou identidade é obrigatório.'
      );
    }
    if (hasDeliveryId) return repository.get(input.deliveryId!);
    return repository.getByIdentity(input.identity!);
  }

  return {
    enqueue,
    process,
    processDue,
    applyEvolutionEvent,
    get,
    list: (filters) => repository.list(filters),
    resolve: (input) => repository.resolve(input),
  };
}

export const createDeliveryModule = createQuotationDeliveryModule;
