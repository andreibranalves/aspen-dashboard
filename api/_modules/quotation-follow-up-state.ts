export const FOLLOW_UP_WAIT_MS = 24 * 60 * 60 * 1000;
export const FOLLOW_UP_LEASE_MS = 90_000;
export const FOLLOW_UP_MESSAGE_MAX_CHARS = 4_000;
export const FOLLOW_UP_IMMEDIATE_PUBLISH_DAILY_CAP = 100;
export const ELIGIBLE_QUOTATION_STATUS = 'emitido';
export const ELIGIBLE_CRM_STATUS = 'Orcamento Enviado';
export const FOLLOW_UP_CHANNEL = 'whatsapp';

export const DISMISS_REASONS = [
  'already_handled',
  'do_not_contact',
  'no_continuity',
  'wrong_contact',
  'other',
] as const;

export const CANCELLATION_REASONS = [
  'before_tracking_start',
  'newer_delivery_in_flight',
  'delivery_incomplete',
  'missing_provider_receipt',
  'quotation_not_issued',
  'crm_not_eligible',
  'client_archived',
  'identity_unresolved',
  'contact_blocked',
  'inbound_after_anchor',
  'outbound_after_anchor',
  'already_attempted',
  'instance_changed',
] as const;

export const TEMPORARY_HOLD_REASONS = [
  'ingestion_blocked',
  'unresolved_identity_barrier',
  'external_writes_disabled',
] as const;

export const FOLLOW_UP_REASON_LABELS: Record<string, string> = {
  awaiting_receipt: 'Aguardando recibo do WhatsApp',
  waiting: 'Aguardando 24h',
  ready: 'Silêncio após o recibo',
  held: 'Identidade LID não associada',
  approved: 'Aprovado, aguardando envio',
  processing: 'Enviando',
  sent: 'Follow-up enviado',
  cancelled: 'Cancelado',
  dismissed: 'Dispensado',
  needs_review: 'Envio sem confirmação',
  failed: 'Falha de transporte',
  inbound_after_anchor: 'Cliente respondeu',
  outbound_after_anchor: 'Houve outro envio',
  newer_delivery_in_flight: 'Novo envio em andamento',
  missing_provider_receipt: 'Sem recibo de entrega',
  quotation_not_issued: 'Orçamento não emitido',
  crm_not_eligible: 'CRM fora de Orçamento Enviado',
  client_archived: 'Cliente arquivado',
  identity_unresolved: 'Contato sem telefone confiável',
  contact_blocked: 'Contato bloqueado',
  ingestion_blocked: 'Ingestão do WhatsApp bloqueada',
  unresolved_identity_barrier: 'Identidade LID não associada',
  external_writes_disabled: 'Envio automático desativado',
  already_attempted: 'Já houve tentativa',
  before_tracking_start: 'Anterior ao início do rastreio',
  delivery_incomplete: 'Entrega incompleta',
  provider_rejected: 'WhatsApp recusou',
  rate_limited: 'Limite do WhatsApp',
  transport_ambiguous: 'Falha de transporte',
  lease_expired_after_transport: 'Envio sem confirmação',
  instance_changed: 'Instância do WhatsApp alterada',
  already_handled: 'Já tratado',
  do_not_contact: 'Não contatar',
  no_continuity: 'Sem continuidade',
  wrong_contact: 'Contato incorreto',
  other: 'Outro',
};

export function followUpReasonLabel(reason: string): string {
  return FOLLOW_UP_REASON_LABELS[reason] || reason;
}

export const FOLLOW_UP_PERSISTED_STATES = [
  'awaiting_receipt',
  'waiting',
  'ready',
  'held',
  'approved',
  'processing',
  'sent',
  'cancelled',
  'dismissed',
  'needs_review',
  'failed',
] as const;

export const FOLLOW_UP_TERMINAL_STATES = [
  'sent',
  'cancelled',
  'dismissed',
  'needs_review',
  'failed',
] as const;

export const FOLLOW_UP_IN_FLIGHT_DELIVERY_STATES = [
  'queued',
  'processing',
  'provider_accepted',
  'reconciling',
  'retry_scheduled',
  'needs_review',
  'failed',
] as const;

export const FOLLOW_UP_LIST_VIEWS = [
  'ready',
  'waiting',
  'sent',
  'dismissed',
  'attention',
] as const;

export type DismissReason = (typeof DISMISS_REASONS)[number];
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];
export type TemporaryHoldReason = (typeof TEMPORARY_HOLD_REASONS)[number];
export type FollowUpPersistedState = (typeof FOLLOW_UP_PERSISTED_STATES)[number];
export type FollowUpTerminalState = (typeof FOLLOW_UP_TERMINAL_STATES)[number];
export type FollowUpInFlightDeliveryState = (typeof FOLLOW_UP_IN_FLIGHT_DELIVERY_STATES)[number];
export type FollowUpListView = (typeof FOLLOW_UP_LIST_VIEWS)[number];
export type FollowUpProjectionState = 'awaiting_receipt' | 'waiting' | 'ready' | 'held';

export type FollowUpReason = keyof typeof FOLLOW_UP_REASON_LABELS;


export type FollowUpDeliveryFacts = {
  id: string;
  state: string;
  completionSource: string | null;
  createdAt: Date;
  firstProviderReceiptAt: Date | null;
};

export type FollowUpCandidateFacts = {
  now: Date;
  trackingStartedAt: Date;
  persistedState: FollowUpPersistedState | null;
  persistedDueAt?: Date | null;
  latestDelivery: FollowUpDeliveryFacts | null;
  quotationStatus: string;
  crmStatus: string | null;
  clientArchived: boolean;
  identityResolved: boolean;
  contactBlocked: boolean;
  ingestionBlocked: boolean;
  unresolvedIdentityBarrier: boolean;
  inboundAfterAnchor: boolean;
  outboundAfterAnchor: boolean;
  /** Current commercial cycle stage, when the quotation is linked to CRM. */
  commercialFollowUpStage?: number;
  /** Attempt number within the current cycle, when persisted on the queue row. */
  followUpAttempt?: number;
};


export type FollowUpEvaluation =
  | { kind: 'awaiting_receipt'; reason: 'awaiting_receipt' }
  | { kind: 'waiting'; dueAt: Date; firstProviderReceiptAt: Date }
  | { kind: 'ready'; dueAt: Date; firstProviderReceiptAt: Date }
  | { kind: 'eligible_to_send'; dueAt: Date; firstProviderReceiptAt: Date }
  | { kind: 'absent'; reason: CancellationReason | TemporaryHoldReason }
  | { kind: 'cancel'; reason: CancellationReason }
  | { kind: 'hold'; reason: CancellationReason | TemporaryHoldReason };

const TERMINAL = new Set<string>(FOLLOW_UP_TERMINAL_STATES);
const IN_FLIGHT = new Set<string>(FOLLOW_UP_IN_FLIGHT_DELIVERY_STATES);
const DISMISS = new Set<string>(DISMISS_REASONS);
const CANCEL = new Set<string>(CANCELLATION_REASONS);
const ALLOWED_TRANSITIONS: Record<FollowUpPersistedState, readonly FollowUpPersistedState[]> = {
  awaiting_receipt: ['awaiting_receipt', 'waiting', 'held', 'cancelled', 'dismissed'],
  waiting: ['waiting', 'ready', 'held', 'cancelled', 'dismissed'],
  ready: ['ready', 'waiting', 'held', 'cancelled', 'dismissed'],
  held: ['awaiting_receipt', 'waiting', 'ready', 'held', 'cancelled', 'dismissed'],
  approved: ['processing', 'cancelled'],
  processing: ['approved', 'sent', 'failed', 'needs_review', 'cancelled'],
  sent: [],
  cancelled: [],
  dismissed: [],
  needs_review: [],
  failed: [],
};

export function isDismissReason(value: string): value is DismissReason {
  return DISMISS.has(value);
}

export function isCancellationReason(value: string): value is CancellationReason {
  return CANCEL.has(value);
}

export function isFollowUpPersistedState(value: string): value is FollowUpPersistedState {
  return (FOLLOW_UP_PERSISTED_STATES as readonly string[]).includes(value);
}

export function isFollowUpTerminalState(value: string): value is FollowUpTerminalState {
  return TERMINAL.has(value);
}

export function isFollowUpListView(value: string): value is FollowUpListView {
  return (FOLLOW_UP_LIST_VIEWS as readonly string[]).includes(value);
}

export function followUpListView(
  state: FollowUpProjectionState | FollowUpPersistedState,
): FollowUpListView {
  if (state === 'ready' || state === 'waiting' || state === 'sent' || state === 'dismissed') {
    return state;
  }
  return 'attention';
}
export function followUpVisibleListView(
  persistedState: FollowUpPersistedState | null | undefined,
  evaluation: FollowUpEvaluation,
): FollowUpListView | null {
  if (!persistedState) return null;
  if (evaluation.kind === 'cancel' || evaluation.kind === 'hold') return 'attention';
  if (evaluation.kind === 'ready') return 'ready';
  if (evaluation.kind === 'waiting') return 'waiting';
  if (evaluation.kind === 'awaiting_receipt') return 'attention';
  return followUpListView(persistedState);
}


export function canTransitionFollowUp(
  from: FollowUpPersistedState,
  to: FollowUpPersistedState,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function followUpDueAt(firstProviderReceiptAt: Date): Date {
  return new Date(firstProviderReceiptAt.getTime() + FOLLOW_UP_WAIT_MS);
}

export function isFollowUpReady(firstProviderReceiptAt: Date, now: Date): boolean {
  return now.getTime() >= followUpDueAt(firstProviderReceiptAt).getTime();
}

function isAllowedWhatsappControl(code: number): boolean {
  return code === 0x09 || code === 0x0a;
}

export function hasDisallowedWhatsappControls(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    if (isAllowedWhatsappControl(code)) return false;
    return code <= 0x1f || code === 0x7f;
  });
}

export function normalizeWhatsappOutboundText(value: string): string | null {
  if (typeof value !== 'string' || hasDisallowedWhatsappControls(value)) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > FOLLOW_UP_MESSAGE_MAX_CHARS) return null;
  return normalized;
}

export function buildDefaultFollowUpMessage(input: {
  clientName: string;
  businessNumber: string;
}): string {
  const name = input.clientName.trim();
  const greeting = name ? `Olá, ${name}.` : 'Olá.';
  return `${greeting}\n\nPassando para saber se você teve a chance de ver o orçamento ${input.businessNumber}. Qualquer dúvida, estou à disposição.`;
}

export function shouldPublishFollowUpImmediately(approvalsCreatedTodayUtc: number): boolean {
  return approvalsCreatedTodayUtc < FOLLOW_UP_IMMEDIATE_PUBLISH_DAILY_CAP;
}

export function followUpExternalWritesEnabled(env: {
  APP_ENV?: string;
  EXTERNAL_WRITES_ENABLED?: string;
  QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED?: string;
}): boolean {
  return (
    env.QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED === '1' &&
    env.APP_ENV === 'production' &&
    env.EXTERNAL_WRITES_ENABLED === '1'
  );
}

export function parseFollowUpTrackingStartedAt(value: string | undefined): Date | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function recoverExpiredFollowUpLease(input: {
  state: FollowUpPersistedState;
  transportStartedAt: Date | null;
  leaseUntil: Date;
  now: Date;
}): FollowUpPersistedState | null {
  if (input.state !== 'processing') return null;
  if (input.now.getTime() < input.leaseUntil.getTime()) return null;
  if (input.transportStartedAt) return 'needs_review';
  return 'approved';
}

function fail(
  persisted: FollowUpPersistedState | null,
  reason: CancellationReason,
): FollowUpEvaluation {
  return persisted && persisted !== 'sent' && persisted !== 'dismissed' && persisted !== 'failed' && persisted !== 'needs_review' && persisted !== 'cancelled'
    ? { kind: 'cancel', reason }
    : { kind: 'absent', reason };
}

function hold(
  persisted: FollowUpPersistedState | null,
  reason: TemporaryHoldReason,
): FollowUpEvaluation {
  return persisted && persisted !== 'sent' && persisted !== 'dismissed' && persisted !== 'failed' && persisted !== 'needs_review' && persisted !== 'cancelled'
    ? { kind: 'hold', reason }
    : { kind: 'absent', reason };
}

export function evaluateFollowUp(input: FollowUpCandidateFacts): FollowUpEvaluation {
  if (input.persistedState && TERMINAL.has(input.persistedState)) {
    return { kind: 'absent', reason: 'already_attempted' };
  }

  if (
    input.followUpAttempt !== undefined &&
    input.commercialFollowUpStage !== undefined &&
    (input.commercialFollowUpStage >= 2 ||
      input.followUpAttempt > input.commercialFollowUpStage + 1)
  ) {
    return fail(input.persistedState, 'already_attempted');
  }

  const delivery = input.latestDelivery;
  if (!delivery || delivery.createdAt.getTime() < input.trackingStartedAt.getTime()) {
    return fail(input.persistedState, 'before_tracking_start');
  }

  if (input.inboundAfterAnchor) {
    return fail(input.persistedState, 'inbound_after_anchor');
  }
  if (input.unresolvedIdentityBarrier) {
    return hold(input.persistedState, 'unresolved_identity_barrier');
  }
  if (input.outboundAfterAnchor) {
    return fail(input.persistedState, 'outbound_after_anchor');
  }

  if (input.quotationStatus !== ELIGIBLE_QUOTATION_STATUS) {
    return fail(input.persistedState, 'quotation_not_issued');
  }
  if (input.crmStatus !== ELIGIBLE_CRM_STATUS) {
    return fail(input.persistedState, 'crm_not_eligible');
  }
  if (input.clientArchived) {
    return fail(input.persistedState, 'client_archived');
  }
  if (input.contactBlocked) {
    return fail(input.persistedState, 'contact_blocked');
  }
  if (input.ingestionBlocked) {
    return hold(input.persistedState, 'ingestion_blocked');
  }
  if (!input.identityResolved && input.persistedState === 'held') {
    return { kind: 'hold', reason: 'identity_unresolved' };
  }

  const acceptedWithoutReceipt =
    delivery.state === 'provider_accepted' ||
    (delivery.state === 'delivered' && !delivery.firstProviderReceiptAt);
  if (
    acceptedWithoutReceipt &&
    input.persistedState !== 'approved' &&
    input.persistedState !== 'processing'
  ) {
    return { kind: 'awaiting_receipt', reason: 'awaiting_receipt' };
  }

  if (IN_FLIGHT.has(delivery.state)) {
    return fail(input.persistedState, 'newer_delivery_in_flight');
  }

  if (delivery.state !== 'delivered' || delivery.completionSource !== 'provider_receipt') {
    return fail(input.persistedState, 'delivery_incomplete');
  }

  if (!delivery.firstProviderReceiptAt) {
    return fail(input.persistedState, 'missing_provider_receipt');
  }
  if (!input.identityResolved) {
    return fail(input.persistedState, 'identity_unresolved');
  }


  const dueAt = input.persistedDueAt ?? followUpDueAt(delivery.firstProviderReceiptAt);
  if (input.persistedState === 'approved' || input.persistedState === 'processing') {
    return {
      kind: 'eligible_to_send',
      dueAt,
      firstProviderReceiptAt: delivery.firstProviderReceiptAt,
    };
  }

  if (input.now.getTime() < dueAt.getTime()) {
    return {
      kind: 'waiting',
      dueAt,
      firstProviderReceiptAt: delivery.firstProviderReceiptAt,
    };
  }

  return {
    kind: 'ready',
    dueAt,
    firstProviderReceiptAt: delivery.firstProviderReceiptAt,
  };
}
