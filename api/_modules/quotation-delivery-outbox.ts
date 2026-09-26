import {
  createQuotationDeliveryDocuments,
  type PreparedDeliveryDocument,
  type PreparedDeliveryImage,
} from './quotation-delivery-documents.js';
import {
  createPostgresWhatsappContactActivityRepository,
  type WhatsappContactActivityRepository,
} from '../_infrastructure/db/repositories/whatsapp-contact-activity-repository.js';
import {
  createPostgresQuotationFollowUpRepository,
  type QuotationFollowUpRepository,
} from '../_infrastructure/db/repositories/quotation-follow-up-repository.js';
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
} from '../_infrastructure/db/repositories/quotation-delivery-outbox-repository.js';
import { createQuotationTemplateRepository } from '../_infrastructure/db/repositories/quotation-template-repository.js';
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
import { normalizeWhatsappPhone } from '../_shared/whatsapp-phone.js';
import {
  REVISION_UNAVAILABLE_PUBLIC_ERROR,
  retryDelayMs,
  type EvolutionReceiptStatus,
  type TransportFailureKind,
} from './quotation-delivery-state.js';

export const DELIVERY_LEASE_MS = 90_000;
export const RECONCILIATION_WAIT_MS = 120_000;
export const PROVIDER_DELAY_WARNING_MS = 86_400_000;
export const DEFAULT_PROCESS_DUE_LIMIT = 20;
export const MAX_PROCESS_DUE_LIMIT = 50;
// Caps how many follow-up projection candidates one pass may attempt, so a
// poisoned slice can never monopolize the worker before outbound claims.
export const FOLLOW_UP_RECONCILIATION_BATCH = 20;

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

function isIgnoredRemoteJid(value: string): boolean {
  const remoteJid = value.trim().toLowerCase();
  return (
    remoteJid.endsWith('@g.us') ||
    remoteJid.endsWith('@broadcast') ||
    remoteJid === 'status@broadcast'
  );
}

const PUBLIC_ERRORS: Record<TransportFailureKind, string> = {
  transient_pre_transport: 'Falha transitória antes do transporte. Tente novamente.',
  permanent_pre_transport: 'O envio foi rejeitado antes do transporte.',
  ambiguous: 'O resultado do transporte requer reconciliação. Não reenvie automaticamente.',
};

// Retry budget is exhausted on the attempt whose delay is `null`. The failure is
// still provably pre-transport, so the copy states the cause and leaves the
// explicit same-revision re-send (the action offered next to it) to speak for
// itself.
const EXHAUSTED_PRE_TRANSPORT_PUBLIC_ERROR =
  'As tentativas de envio se esgotaram antes do transporte.';

const PDF_PUBLIC_ERRORS: Record<'transient' | 'permanent', string> = {
  transient: 'PDF indisponível. Tentar novamente.',
  permanent: REVISION_UNAVAILABLE_PUBLIC_ERROR,
};
const WEBP_PUBLIC_ERRORS: Record<'transient' | 'permanent', string> = {
  transient: 'Imagem do orçamento indisponível. Tentar novamente.',
  permanent: REVISION_UNAVAILABLE_PUBLIC_ERROR,
};

type DeliveryEnqueueInput = DeliveryIdentity & {
  quotationId?: string;
  businessNumber?: string;
};
type DeliveryPlanner = (input: DeliveryPlanInput) => Promise<DeliveryPlan>;
type DeliveryDocumentPreparer = (revisionId: string) => Promise<PreparedDeliveryDocument>;
type DeliveryImagePreparer = (revisionId: string) => Promise<PreparedDeliveryImage[]>;
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
  followUpRepository?: Pick<
    QuotationFollowUpRepository,
    | 'upsertAwaitingReceiptFromAcceptedDelivery'
    | 'upsertFromDeliveryReceipt'
    | 'listAcceptedDeliveriesMissingFollowUp'
    | 'markAcceptanceProjectionAttempt'
    | 'listAwaitingReceiptWithCompletedDelivery'
    | 'markReceiptProjectionAttempt'
  >;
  followUpRepositoryFactory?: () => Pick<
    QuotationFollowUpRepository,
    | 'upsertAwaitingReceiptFromAcceptedDelivery'
    | 'upsertFromDeliveryReceipt'
    | 'listAcceptedDeliveriesMissingFollowUp'
    | 'markAcceptanceProjectionAttempt'
    | 'listAwaitingReceiptWithCompletedDelivery'
    | 'markReceiptProjectionAttempt'
  >;
  activityRepository?: Pick<WhatsappContactActivityRepository, 'recordActivity'>;
  planner?: DeliveryPlanner;
  plan?: DeliveryPlanner;
  createPlan?: DeliveryPlanner;
  prepareDeliveryDocument?: DeliveryDocumentPreparer;
  prepareDocument?: DeliveryDocumentPreparer;
  preparePdf?: DeliveryDocumentPreparer;
  pdfRenderer?: DeliveryDocumentPreparer;
  prepareDeliveryImages?: DeliveryImagePreparer;
  prepareImages?: DeliveryImagePreparer;
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
  remoteJid?: string;
}

export interface QuotationDeliveryModule {
  /** Records the envio and its steps; only the worker transports them (ADR 0013). */
  enqueue(input: DeliveryIdentity): Promise<DeliveryAggregate>;
  /** Sends the due steps of one envio; a step in its pause waits for a later call. */
  process(deliveryId?: string): Promise<DeliveryAggregate | null>;
  /**
   * `processed` counts claims and expired reconciliations. Steps still in their
   * pause are left to the worker's schedule. `stop` ends the batch before the
   * next claim; the step already claimed finishes.
   */
  processDue(limit: number, stop?: AbortSignal): Promise<{ processed: number; remaining: boolean }>;
  applyEvolutionEvent(event: EvolutionMessageEvent): Promise<DeliveryAggregate | null>;
  cancelPending(): Promise<number>;
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
  reconciliationPending: boolean;
}

/**
 * Result of one bounded reconciliation pass. `sticky` is fail-closed: the
 * source could not be inspected or a durable projection failed — the caller
 * must keep reporting work. `hasMore` is
 * temporary saturation of the source slice, which a later successful pass that
 * drains the source is allowed to clear.
 */
interface ReconciliationOutcome {
  sticky: boolean;
  hasMore: boolean;
}

const NO_RECONCILIATION: ReconciliationOutcome = { sticky: false, hasMore: false };
const STICKY_RECONCILIATION: ReconciliationOutcome = { sticky: true, hasMore: false };

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

function imageFailure(error: unknown): DeliveryStepFailure {
  if (error instanceof DeliveryStepFailure) return error;
  if (error instanceof EvolutionTransportError) {
    return new DeliveryStepFailure(
      error.kind,
      safeCode(error.code, 'EVOLUTION_UNKNOWN'),
      PUBLIC_ERRORS[error.kind],
    );
  }
  if (isPermanentRevisionFailure(error)) {
    return new DeliveryStepFailure(
      'permanent_pre_transport',
      'QUOTATION_REVISION_INVALID',
      WEBP_PUBLIC_ERRORS.permanent,
    );
  }
  return new DeliveryStepFailure(
    'transient_pre_transport',
    'QUOTATION_WEBP_RENDER',
    WEBP_PUBLIC_ERRORS.transient,
  );
}

function normalizedImage(
  value: unknown,
  now: () => Date,
  fallbackPage: number,
  fallbackPageCount: number,
): PreparedDeliveryImage {
  const candidate =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<PreparedDeliveryImage>)
      : null;
  if (!candidate || !Buffer.isBuffer(candidate.webp) || candidate.webp.length === 0) {
    throw new DeliveryStepFailure(
      'transient_pre_transport',
      'QUOTATION_WEBP_INVALID',
      WEBP_PUBLIC_ERRORS.transient,
    );
  }
  if (
    candidate.webpSize !== undefined &&
    (!Number.isSafeInteger(candidate.webpSize) || candidate.webpSize !== candidate.webp.length)
  ) {
    throw new DeliveryStepFailure(
      'transient_pre_transport',
      'QUOTATION_WEBP_INVALID',
      WEBP_PUBLIC_ERRORS.transient,
    );
  }
  if (candidate.validUntil !== undefined) {
    if (!validDate(candidate.validUntil)) {
      throw new DeliveryStepFailure(
        'permanent_pre_transport',
        'QUOTATION_REVISION_INVALID',
        WEBP_PUBLIC_ERRORS.permanent,
      );
    }
    if (now().getTime() >= candidate.validUntil.getTime()) {
      throw new DeliveryStepFailure(
        'permanent_pre_transport',
        'QUOTATION_REVISION_EXPIRED',
        WEBP_PUBLIC_ERRORS.permanent,
      );
    }
  }
  return {
    webp: candidate.webp,
    webpSize: candidate.webpSize === candidate.webp.length ? candidate.webpSize : candidate.webp.length,
    webpSignature: typeof candidate.webpSignature === 'string' ? candidate.webpSignature : '',
    page: Number.isSafeInteger(candidate.page) && (candidate.page as number) > 0
      ? candidate.page as number
      : fallbackPage,
    pageCount: Number.isSafeInteger(candidate.pageCount) && (candidate.pageCount as number) > 0
      ? candidate.pageCount as number
      : fallbackPageCount,
    validUntil: validDate(candidate.validUntil)
      ? candidate.validUntil
      : new Date(now().getTime() + 1),
  };
}

function normalizedImages(value: unknown, now: () => Date): PreparedDeliveryImage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new DeliveryStepFailure(
      'transient_pre_transport',
      'QUOTATION_WEBP_INVALID',
      WEBP_PUBLIC_ERRORS.transient,
    );
  }
  return value.map((item, index) => normalizedImage(item, now, index + 1, value.length));
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

// Durable step timestamps carry the true provider receipt clock (the inbox
// `received_at`, never the clock at fold time). A delivery is receipt-complete
// when its latest step receipt arrived, which is what the follow-up records as
// `first_provider_receipt_at`.
function receiptOccurredAt(delivery: DeliveryAggregate, fallback: Date): Date {
  const times = (delivery.steps || [])
    .map((step) => step.deliveredAt || step.readAt)
    .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()))
    .map((value) => value.getTime());
  return times.length > 0 ? new Date(Math.max(...times)) : new Date(fallback.getTime());
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
  const instance = String(
    dependencies.instance || globalThis.process?.env?.EVOLUTION_INSTANCE || ''
  ).trim();
  const repository =
    dependencies.repository ||
    dependencies.repositoryFactory?.() ||
    createPostgresQuotationDeliveryOutboxRepository(undefined, {
      now,
      leaseMs: DELIVERY_LEASE_MS,
      reconciliationMs: RECONCILIATION_WAIT_MS,
    });
  const followUpRepository =
    dependencies.followUpRepository ||
    dependencies.followUpRepositoryFactory?.() ||
    (!dependencies.repository && !dependencies.repositoryFactory
      ? createPostgresQuotationFollowUpRepository()
      : undefined);
  const activityRepository =
    dependencies.activityRepository ||
    (!dependencies.repository && !dependencies.repositoryFactory
      ? createPostgresWhatsappContactActivityRepository()
      : undefined);

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
  const configuredPlanner = dependencies.planner || dependencies.plan || dependencies.createPlan;
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
      fallbackDocumentPreparer ||= createQuotationDeliveryDocuments({ now }).prepareDeliveryDocument;
      return fallbackDocumentPreparer;
    })();
  let fallbackImagePreparer: DeliveryImagePreparer | undefined;
  const imagePreparer =
    dependencies.prepareDeliveryImages ||
    dependencies.prepareImages ||
    (() => {
      fallbackImagePreparer ||= createQuotationDeliveryDocuments({ now }).prepareDeliveryImages;
      return fallbackImagePreparer;
    })();
  const inFlight = new Map<string, Promise<DeliveryAggregate | null>>();
  const webpCache = new Map<string, PreparedDeliveryImage[]>();

  interface PreparedStep {
    document?: PreparedDeliveryDocument;
    image?: PreparedDeliveryImage;
    expanded?: boolean;
  }

  async function prepareStep(claimed: ClaimedDeliveryStep): Promise<PreparedStep> {
    const snapshot = claimed.step.snapshot;
    if (snapshot.type === 'quotation_pdf') {
      if (snapshot.payload.revisionId !== claimed.delivery.revisionId) {
        throw new DeliveryStepFailure(
          'permanent_pre_transport',
          'QUOTATION_REVISION_MISMATCH',
          PDF_PUBLIC_ERRORS.permanent,
        );
      }
      try {
        return {
          document: normalizedDocument(
            await documentPreparer(snapshot.payload.revisionId),
            now,
          ),
        };
      } catch (error) {
        throw documentFailure(error);
      }
    }
    if (snapshot.type !== 'quotation_webp') return {};
    if (snapshot.payload.revisionId !== claimed.delivery.revisionId) {
      throw new DeliveryStepFailure(
        'permanent_pre_transport',
        'QUOTATION_REVISION_MISMATCH',
        WEBP_PUBLIC_ERRORS.permanent,
      );
    }
    try {
      let pages = webpCache.get(claimed.delivery.id);
      if (!pages) {
        pages = normalizedImages(await imagePreparer(snapshot.payload.revisionId), now);
        webpCache.set(claimed.delivery.id, pages);
      }
      if (snapshot.payload.page === 0) {
        const baseName = snapshot.payload.fileName.replace(/\\.webp$/i, '') || 'orcamento';
        await repository.expandQuotationWebpStep({
          deliveryId: claimed.delivery.id,
          stepId: claimed.step.id,
          leaseToken: claimed.leaseToken,
          steps: pages.map((page, index) => ({
            position: snapshot.position + index,
            type: 'quotation_webp' as const,
            payload: {
              revisionId: snapshot.payload.revisionId,
              fileName: `${baseName}.pagina-${index + 1}.webp`,
              caption: index === 0 ? snapshot.payload.caption : '',
              page: index + 1,
              pageCount: pages!.length,
            },
            delayMs: snapshot.delayMs,
          })),
        });
        return { expanded: true };
      }
      const page = pages[snapshot.payload.page - 1];
      if (!page || page.pageCount !== snapshot.payload.pageCount) {
        throw new DeliveryStepFailure(
          'transient_pre_transport',
          'QUOTATION_WEBP_PAGE_INVALID',
          WEBP_PUBLIC_ERRORS.transient,
        );
      }
      return { image: page };
    } catch (error) {
      throw imageFailure(error);
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

  async function retryFollowUpAcceptanceWrites(
    targetDeliveryId?: string,
    maxCandidates = FOLLOW_UP_RECONCILIATION_BATCH
  ): Promise<ReconciliationOutcome> {
    const list = followUpRepository?.listAcceptedDeliveriesMissingFollowUp;
    const upsert = followUpRepository?.upsertAwaitingReceiptFromAcceptedDelivery;
    if (!list || !upsert) return NO_RECONCILIATION;
    const markAttempt = followUpRepository?.markAcceptanceProjectionAttempt;
    let page: Awaited<ReturnType<typeof list>>;
    try {
      page = await list(
        targetDeliveryId
          ? { deliveryId: targetDeliveryId, limit: maxCandidates }
          : { limit: maxCandidates },
      );
    } catch {
      // The acceptance source itself could not be inspected. Uninspected
      // durable work must never be reported drained, so fail closed.
      logEvent(
        logger,
        {
          deliveryId: targetDeliveryId || '',
          stepId: '',
          state: 'provider_accepted',
          errorCode: 'FOLLOW_UP_ACCEPTANCE_SOURCE',
          duration: 0,
        },
        'error',
      );
      return STICKY_RECONCILIATION;
    }
    let processed = 0;
    let persistenceFailed = false;
    for (const row of page.data) {
      if (processed >= maxCandidates) {
        // The durable slice still has candidates beyond this pass: temporary
        // saturation, not a failure. A later successful pass may clear it.
        return { sticky: persistenceFailed, hasMore: true };
      }
      processed += 1;
      // The durable rotation marker is written before the projection, so a
      // persistently failing candidate still moves to the tail and cannot
      // starve 51+ later candidates across passes.
      if (markAttempt) {
        try {
          await markAttempt({ deliveryId: row.deliveryId });
        } catch {
          persistenceFailed = true;
          logEvent(
            logger,
            {
              deliveryId: row.deliveryId,
              stepId: '',
              state: 'provider_accepted',
              errorCode: 'FOLLOW_UP_ACCEPTANCE_PERSISTENCE',
              duration: 0,
            },
            'error',
          );
          continue;
        }
      }
      try {
        // Activity is recorded before the follow-up on purpose: the durable
        // retry source is `deliveries without an active follow-up`, so as long
        // as the activity could not be persisted the follow-up must not be
        // created. `recordActivity` is idempotent per (instance, conversation),
        // so re-running it on a retry cannot duplicate the row.
        const canonicalPhone = normalizeWhatsappPhone(row.phone);
        if (activityRepository && canonicalPhone) {
          await activityRepository.recordActivity({
            instance,
            providerConversationId: `${canonicalPhone}@s.whatsapp.net`,
            providerMessageId: row.providerMessageId,
            fromMe: true,
            occurredAt: row.acceptedAt || now(),
            identityStatus: 'derived',
            canonicalPhone,
          });
        }
        await upsert(row);
      } catch {
        persistenceFailed = true;
        logEvent(
          logger,
          {
            deliveryId: row.deliveryId,
            stepId: '',
            state: 'provider_accepted',
            errorCode: 'FOLLOW_UP_ACCEPTANCE_PERSISTENCE',
            duration: 0,
          },
          'error',
        );
      }
    }
    return { sticky: persistenceFailed, hasMore: page.hasMore };
  }

  // The receipt fold and the follow-up projection cannot share one transaction
  // (different repositories), so a transient projection failure after the fold
  // must not be terminal. The delivered outbox row is durable proof of the
  // receipt; this worker reconciliation re-projects from that proof — no
  // provider replay and no second queue.
  //
  // The pass is bounded by a per-pass candidate budget, and each attempted
  // candidate's durable retry order is refreshed so a persistent poison row
  // rotates to the tail instead of head-of-line blocking the rest forever.
  // `remaining` reports the unconsumed slice honestly, and an uninspectable
  // source fails closed.
  async function retryFollowUpReceiptWrites(
    targetDeliveryId?: string,
    maxCandidates = FOLLOW_UP_RECONCILIATION_BATCH
  ): Promise<ReconciliationOutcome> {
    const list = followUpRepository?.listAwaitingReceiptWithCompletedDelivery;
    const upsert = followUpRepository?.upsertFromDeliveryReceipt;
    if (!list || !upsert) return NO_RECONCILIATION;
    const markAttempt = followUpRepository?.markReceiptProjectionAttempt;
    let page: Awaited<ReturnType<typeof list>>;
    try {
      page = await list(
        targetDeliveryId
          ? { deliveryId: targetDeliveryId, limit: maxCandidates }
          : { limit: maxCandidates },
      );
    } catch {
      // The receipt source itself could not be inspected. Uninspected durable
      // work must never be reported drained, so fail closed.
      logEvent(
        logger,
        {
          deliveryId: targetDeliveryId || '',
          stepId: '',
          state: 'delivered',
          errorCode: 'FOLLOW_UP_RECEIPT_SOURCE',
          duration: 0,
        },
        'error'
      );
      return STICKY_RECONCILIATION;
    }
    let processed = 0;
    let projectionFailed = false;
    for (const row of page.data) {
      if (processed >= maxCandidates) {
        // Temporary source saturation that a later pass may clear.
        return { sticky: projectionFailed, hasMore: true };
      }
      processed += 1;
      // Rotation is durable and written before the projection: a projection that
      // fails still moves the candidate to the tail and can never strand the
      // same row at the head of every pass. Touching the row's retry order is
      // not a claim that the business projection succeeded.
      if (markAttempt) {
        try {
          await markAttempt({ followUpId: row.followUpId });
        } catch {
          projectionFailed = true;
          logEvent(
            logger,
            {
              deliveryId: row.deliveryId,
              stepId: '',
              state: 'delivered',
              errorCode: 'FOLLOW_UP_RECEIPT_PERSISTENCE',
              duration: 0,
            },
            'error'
          );
          continue;
        }
      }
      try {
        await upsert({
          deliveryId: row.deliveryId,
          revisionId: row.revisionId,
          phone: row.phone,
          // Outbox steps are direct phone recipients; a LID value is passed
          // through so the writer can resolve the identity itself.
          providerConversationId: row.phone.includes('@')
            ? row.phone
            : `${row.phone}@s.whatsapp.net`,
          allStepsDelivered: true,
          receivedAt: row.receivedAt,
        });
      } catch {
        projectionFailed = true;
        logEvent(
          logger,
          {
            deliveryId: row.deliveryId,
            stepId: '',
            state: 'delivered',
            errorCode: 'FOLLOW_UP_RECEIPT_PERSISTENCE',
            duration: 0,
          },
          'error'
        );
      }
    }
    return { sticky: projectionFailed, hasMore: page.hasMore };
  }

  async function processInternal(
    deliveryId: string | undefined,
    maxClaims = Number.POSITIVE_INFINITY,
    stop?: AbortSignal
  ): Promise<ProcessResult> {
    let latest: DeliveryAggregate | null = null;
    let claims = 0;
    // Both reconciliation sources must run: short-circuiting one on the other's
    // remaining work would reintroduce the starvation this pass exists to fix.
    const acceptanceStart = await retryFollowUpAcceptanceWrites(deliveryId);
    const receiptStart = await retryFollowUpReceiptWrites(deliveryId);
    // A sticky failure stays true for the invocation. `hasMore` saturation from
    // the start pass is provisional: the end pass re-inspects the source and may
    // prove it drained.
    const reconciliationSticky = acceptanceStart.sticky || receiptStart.sticky;
    // A step still in its pause is never waited for here: the worker's schedule
    // wakes it when due, so a reply or another envio never waits behind it.
    while (claims < maxClaims && !stop?.aborted) {
      const claimed = await repository.claim(deliveryId ? { deliveryId } : {});
      if (!claimed) break;
      claims += 1;
      const startedAt = Date.now();
      let accepted: EvolutionAccepted;
      try {
        const prepared = await prepareStep(claimed);
        if (prepared.expanded) continue;
        // Atomic pre-dispatch fence: preparation can outlive the 90 s lease, and
        // a competing worker may have recovered the delivery (clearing this
        // token and moving the step to `reconciling`). Renewing the exact token
        // and `sending` state — immediately before the provider call — is the
        // last point where ownership can be proven. Losing it must fail closed
        // with zero transport: the durable row already belongs to the recovery
        // path, and an unowned worker can neither classify nor retry it.
        const owned = await repository.renewLease({
          deliveryId: claimed.delivery.id,
          stepId: claimed.step.id,
          leaseToken: claimed.leaseToken,
        });
        if (!owned) {
          logEvent(
            logger,
            {
              deliveryId: claimed.delivery.id,
              stepId: claimed.step.id,
              state: 'reconciling',
              errorCode: 'DELIVERY_LEASE_LOST',
              duration: durationSince(startedAt),
            },
            'warn'
          );
          latest = (await repository.get(claimed.delivery.id)) || latest;
          break;
        }
        const result = transportDependencies
          ? await transport(
              {
                phone: claimed.delivery.phone,
                step: claimed.step.snapshot,
                document: prepared.document,
                image: prepared.image,
              },
              transportDependencies,
            )
          : await transport({
              phone: claimed.delivery.phone,
              step: claimed.step.snapshot,
              document: prepared.document,
              image: prepared.image,
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
        latest = await persistFailure(
          claimed,
          failure.kind === 'transient_pre_transport' &&
            retryDelayMs(claimed.step.attemptCount) === null
            ? { ...failure, publicError: EXHAUSTED_PRE_TRANSPORT_PUBLIC_ERROR }
            : failure,
        );
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
        const firstAcceptedStep = latest.steps
          .filter((step) => step.acceptedAt)
          .sort((left, right) => left.position - right.position)[0];
        const upsertAcceptance = followUpRepository?.upsertAwaitingReceiptFromAcceptedDelivery;
        // Activity is persisted before the follow-up on purpose: the durable
        // retry source is `accepted deliveries without an active follow-up`, so
        // it must survive until the activity is complete too. `recordActivity`
        // is idempotent per (instance, conversation), so a retry cannot create a
        // duplicate. When the activity write fails, both the acceptance and the
        // folded-receipt follow-up projections are skipped and recovered by the
        // worker reconciliation.
        let acceptedActivityBlocked = false;
        if (firstAcceptedStep?.id === claimed.step.id && upsertAcceptance) {
          const canonicalPhone = normalizeWhatsappPhone(claimed.delivery.phone);
          if (activityRepository && canonicalPhone) {
            try {
              await activityRepository.recordActivity({
                instance,
                providerConversationId: `${canonicalPhone}@s.whatsapp.net`,
                providerMessageId: accepted.providerMessageId,
                fromMe: true,
                occurredAt: firstAcceptedStep.acceptedAt || now(),
                identityStatus: 'derived',
                canonicalPhone,
              });
            } catch {
              acceptedActivityBlocked = true;
              logEvent(
                logger,
                {
                  deliveryId: claimed.delivery.id,
                  stepId: claimed.step.id,
                  state: latest.state,
                  errorCode: 'FOLLOW_UP_ACCEPTANCE_PERSISTENCE',
                  duration: durationSince(startedAt),
                },
                'error',
              );
            }
          }
          if (!acceptedActivityBlocked) {
            try {
              await upsertAcceptance({
                deliveryId: claimed.delivery.id,
                revisionId: claimed.delivery.revisionId,
                phone: claimed.delivery.phone,
                providerMessageId: accepted.providerMessageId,
              });
            } catch {
              logEvent(
                logger,
                {
                  deliveryId: claimed.delivery.id,
                  stepId: claimed.step.id,
                  state: latest.state,
                  errorCode: 'FOLLOW_UP_ACCEPTANCE_PERSISTENCE',
                  duration: durationSince(startedAt),
                },
                'error',
              );
            }
          }
        }
        // A receipt that raced ahead of `markAccepted` is folded inside that
        // transaction. Project its follow-up effect here, in the same pass, so
        // the follow-up does not depend on a webhook replay that will not come.
        const foldedReceipt = latest.steps.find(
          (step) =>
            step.id === claimed.step.id && (step.state === 'delivered' || step.state === 'read')
        );
        if (
          !acceptedActivityBlocked &&
          foldedReceipt &&
          followUpRepository?.upsertFromDeliveryReceipt
        ) {
          try {
            await followUpRepository.upsertFromDeliveryReceipt({
              deliveryId: claimed.delivery.id,
              revisionId: claimed.delivery.revisionId,
              phone: claimed.delivery.phone,
              // The inbox stores no remote jid; outbox steps are direct phone
              // recipients, so the derived conversation is authoritative.
              providerConversationId: `${claimed.delivery.phone}@s.whatsapp.net`,
              allStepsDelivered:
                latest.state === 'delivered' && latest.completionSource === 'provider_receipt',
              receivedAt: receiptOccurredAt(latest, now()),
            });
          } catch {
            logEvent(
              logger,
              {
                deliveryId: claimed.delivery.id,
                stepId: claimed.step.id,
                state: latest.state,
                errorCode: 'FOLLOW_UP_RECEIPT_PERSISTENCE',
                duration: durationSince(startedAt),
              },
              'error',
            );
          }
        }
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
    // The end pass's `hasMore` is the authoritative saturation signal: a
    // successful end pass that drains a source the start pass had saturated
    // clears `remaining`.
    const acceptanceEnd = await retryFollowUpAcceptanceWrites(deliveryId);
    const receiptEnd = await retryFollowUpReceiptWrites(deliveryId);
    const reconciliationPending =
      reconciliationSticky ||
      acceptanceEnd.sticky ||
      receiptEnd.sticky ||
      acceptanceEnd.hasMore ||
      receiptEnd.hasMore;
    if (deliveryId && latest === null) latest = await repository.get(deliveryId);
    else if (deliveryId) latest = (await repository.get(deliveryId)) || latest;
    const cacheDeliveryId = deliveryId || latest?.id;
    if (cacheDeliveryId) webpCache.delete(cacheDeliveryId);
    return { aggregate: latest, claims, reconciliationPending };
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
    const existing = await repository.getByIdentity(input);
    if (existing) return existing;
    return repository.enqueue(deliveryRecord(await planner(input)));
  }

  async function processDue(
    requestedLimit: number,
    stop?: AbortSignal
  ): Promise<{ processed: number; remaining: boolean }> {
    const limit = validateBatchLimit(requestedLimit);
    const expired = await repository.expireReconciliations(limit);
    const result = await processInternal(undefined, limit, stop);
    return {
      processed: result.claims + expired,
      // `remaining` must be honest: a full claim or expiry batch, a stop before
      // the next claim, or unconsumed follow-up reconciliation means the next
      // pass has durable work.
      remaining:
        expired >= limit ||
        result.claims >= limit ||
        Boolean(stop?.aborted) ||
        result.reconciliationPending,
    };
  }

  async function applyEvolutionEvent(
    event: EvolutionMessageEvent
  ): Promise<DeliveryAggregate | null> {
    validateEvent(event, dependencies.instance);
    // The receipt is persisted in the durable inbox even when it races ahead of
    // `markAccepted`: it is correlated later, monotonically, without relying on
    // any provider replay.
    const aggregate = await repository.receiveReceipt({
      providerMessageId: event.providerMessageId,
      status: event.status,
    });
    if (!aggregate) return null;
    if (
      (event.status === 'DELIVERY_ACK' || event.status === 'READ' || event.status === 'PLAYED') &&
      followUpRepository?.upsertFromDeliveryReceipt &&
      !(aggregate.state === 'failed' && aggregate.completionSource === 'operator') &&
      (!event.remoteJid || !isIgnoredRemoteJid(event.remoteJid))
    ) {
      const receivedAt = receiptOccurredAt(aggregate, now());
      try {
        await followUpRepository.upsertFromDeliveryReceipt({
          deliveryId: aggregate.id,
          revisionId: aggregate.revisionId,
          phone: aggregate.phone,
          providerConversationId: event.remoteJid || `${aggregate.phone}@s.whatsapp.net`,
          allStepsDelivered:
            aggregate.state === 'delivered' && aggregate.completionSource === 'provider_receipt',
          receivedAt,
        });
      } catch {
        // The receipt is already durably folded into the outbox step; a failed
        // projection is recoverable by the worker reconciliation, so the
        // webhook must not depend on a provider replay that may never come.
        logEvent(
          logger,
          {
            deliveryId: aggregate.id,
            stepId: '',
            state: aggregate.state,
            errorCode: 'FOLLOW_UP_RECEIPT_PERSISTENCE',
            duration: 0,
          },
          'error',
        );
      }
    }
    return aggregate;
  }

  async function cancelPending(): Promise<number> {
    return repository.cancelPending();
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
    cancelPending,
    get,
    list: (filters) => repository.list(filters),
    resolve: (input) => repository.resolve(input),
  };
}

export const createDeliveryModule = createQuotationDeliveryModule;
