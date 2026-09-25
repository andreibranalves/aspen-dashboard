export type DeliveryState =
  | 'queued'
  | 'processing'
  | 'provider_accepted'
  | 'reconciling'
  | 'retry_scheduled'
  | 'needs_review'
  | 'delivered'
  | 'failed';

export type DeliveryStepState =
  | 'queued'
  | 'sending'
  | 'server_ack'
  | 'reconciling'
  | 'retry_scheduled'
  | 'needs_review'
  | 'delivered'
  | 'read'
  | 'failed';

export type EvolutionReceiptStatus =
  | 'ERROR'
  | 'PENDING'
  | 'SERVER_ACK'
  | 'DELIVERY_ACK'
  | 'READ'
  | 'PLAYED';

export type TransportFailureKind =
  | 'transient_pre_transport'
  | 'permanent_pre_transport'
  | 'ambiguous';

// Public error that classifies a failure as caused by the revision itself being
// undeliverable — expired, invalid, or inconsistent with the frozen step — and
// not by the dispatch. Re-sending the same revision can never repair it, so the
// transactional re-send gate and the screen both refuse the retry and keep the
// existing path: emit a new revision. It is the only durable signal that
// separates this cause from the re-sendable pre-transport rejections (4xx,
// invalid configuration/recipient, local block), which share the same
// `permanent_pre_transport` class.
export const REVISION_UNAVAILABLE_PUBLIC_ERROR =
  'A revisão do orçamento não está disponível para envio.';

// ADR 0013: a message only leaves until 30 min after the operator asked for it.
// Past that, the unsent remainder of an envio is interrupted and never resumed
// on its own; re-sending is an operator decision that opens a new window.
export const SEND_WINDOW_MS = 30 * 60_000;

export const DELIVERY_INTERRUPTED_PUBLIC_ERROR =
  'Envio interrompido: o restante não saiu em 30 min.';

export function isRevisionUnavailableFailure(step: { publicError?: string | null }): boolean {
  return (step.publicError ?? '') === REVISION_UNAVAILABLE_PUBLIC_ERROR;
}

const RECEIPT_RANK: Record<DeliveryStepState, number> = {
  queued: 0,
  retry_scheduled: 0,
  sending: 1,
  reconciling: 1,
  needs_review: 1,
  server_ack: 2,
  delivered: 3,
  read: 4,
  failed: 5,
};

const RECEIPT_STATE: Partial<Record<EvolutionReceiptStatus, DeliveryStepState>> = {
  SERVER_ACK: 'server_ack',
  DELIVERY_ACK: 'delivered',
  READ: 'read',
  PLAYED: 'read',
};

export function applyReceipt(
  current: DeliveryStepState,
  receipt: EvolutionReceiptStatus
): DeliveryStepState {
  if (receipt === 'ERROR') {
    return current === 'delivered' || current === 'read' || current === 'failed'
      ? current
      : 'needs_review';
  }
  const candidate = RECEIPT_STATE[receipt];
  if (!candidate || current === 'failed') return current;
  return RECEIPT_RANK[candidate] > RECEIPT_RANK[current] ? candidate : current;
}

export function aggregateDeliveryState(states: DeliveryStepState[]): DeliveryState {
  if (states.length > 0 && states.every((state) => state === 'delivered' || state === 'read'))
    return 'delivered';
  if (states.some((state) => state === 'needs_review')) return 'needs_review';
  if (states.some((state) => state === 'reconciling')) return 'reconciling';
  if (states.some((state) => state === 'failed')) return 'failed';
  if (states.some((state) => state === 'retry_scheduled')) return 'retry_scheduled';
  if (states.length > 0 && states.every((state) => ['server_ack', 'delivered', 'read'].includes(state)))
    return 'provider_accepted';
  if (states.some((state) => state === 'sending')) return 'processing';
  return 'queued';
}

export function failureTargetState(kind: TransportFailureKind): DeliveryStepState {
  if (kind === 'transient_pre_transport') return 'retry_scheduled';
  if (kind === 'permanent_pre_transport') return 'failed';
  return 'reconciling';
}

export function retryDelayMs(attempt: number): number | null {
  return [60_000, 300_000, 900_000][attempt - 1] ?? null;
}
