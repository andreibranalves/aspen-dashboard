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
