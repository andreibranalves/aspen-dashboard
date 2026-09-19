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
    processed: number;
    remaining: boolean;
  } | null;
  reconcilingSteps: number;
  overdueReconcilingSteps: number;
  oldestReconciliationDeadline: string | null;
  pendingReceipts: number;
  oldestPendingReceiptAt: string | null;
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
  return {
    worker: source
      ? {
          name: typeof source.name === 'string' ? source.name : '',
          lastRunAt: timestamp(source.last_run_at),
          processed: count(source.processed),
          remaining: source.remaining === true,
        }
      : null,
    reconcilingSteps: count(body.reconciling_steps),
    overdueReconcilingSteps: count(body.overdue_reconciling_steps),
    oldestReconciliationDeadline: timestamp(body.oldest_reconciliation_deadline),
    pendingReceipts: count(body.pending_receipts),
    oldestPendingReceiptAt: timestamp(body.oldest_pending_receipt_at),
  };
}
