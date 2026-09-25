import { apiGet } from '@/lib/api/api';

/**
 * Read-only operational diagnostics of the WhatsApp delivery pipeline: the last
 * run of the scheduled worker, the steps parked in reconciliation and the
 * receipts that arrived without a correlated provider id.
 */
export interface DeliveryDiagnostics {
  worker: {
    name: string;
    lastRunAt: string | null;
    result: 'success' | 'failure';
    processed: number;
    remaining: boolean;
  } | null;
  messageSweep: {
    lastRunAt: string | null;
    result: 'success' | 'failure';
    requeued: number;
    toReview: number;
    dispatched: number;
  } | null;
  reconcilingSteps: number;
  pendingReceipts: number;
  /** Work due for more than 10 min that nothing picked up, per source. */
  overdue: { steps: number; followUps: number; replies: number; webhookEffects: number };
  /** The worker never ran or its last run is older than 2 h. */
  workerStale: boolean;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function timestamp(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export async function fetchDeliveryDiagnostics(): Promise<DeliveryDiagnostics> {
  const body = await apiGet<Record<string, unknown>>('/whatsapp-delivery-diagnostics');
  const worker = body.worker;
  const source = worker && typeof worker === 'object' ? (worker as Record<string, unknown>) : null;
  const overdue =
    body.overdue && typeof body.overdue === 'object' ? (body.overdue as Record<string, unknown>) : {};
  const sweep =
    body.message_sweep && typeof body.message_sweep === 'object' ? (body.message_sweep as Record<string, unknown>) : null;
  return {
    worker: source
      ? {
          name: typeof source.name === 'string' ? source.name : '',
          lastRunAt: timestamp(source.last_run_at),
          result: source.result === 'failure' ? 'failure' : 'success',
          processed: count(source.processed),
          remaining: source.remaining === true,
        }
      : null,
    messageSweep: sweep
      ? {
          lastRunAt: timestamp(sweep.last_run_at),
          result: sweep.result === 'failure' ? 'failure' : 'success',
          requeued: count(sweep.requeued),
          toReview: count(sweep.to_review),
          dispatched: count(sweep.dispatched),
        }
      : null,
    reconcilingSteps: count(body.reconciling_steps),
    pendingReceipts: count(body.pending_receipts),
    overdue: {
      steps: count(overdue.steps),
      followUps: count(overdue.follow_ups),
      replies: count(overdue.replies),
      webhookEffects: count(overdue.webhook_effects),
    },
    workerStale: body.worker_stale === true,
  };
}
