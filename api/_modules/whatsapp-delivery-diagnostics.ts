import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  readQuotationDeliveryDiagnostics,
  type QuotationDeliveryDiagnostics,
} from '../_infrastructure/db/repositories/quotation-delivery-diagnostics-repository.js';

export interface WhatsappDeliveryDiagnosticsDependencies {
  readDiagnostics?: () => Promise<QuotationDeliveryDiagnostics>;
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

/**
 * Read-only diagnostics of the WhatsApp delivery pipeline: the last run of the
 * scheduled worker, the steps parked in reconciliation and the receipts that
 * arrived without a correlated provider id. It never sends, claims, expires or
 * repairs anything — it only reports what the durable state already says.
 */
export async function handler(
  event: FunctionEvent,
  dependencies: WhatsappDeliveryDiagnosticsDependencies = {}
): Promise<FunctionResult> {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Método não permitido.' });
  }
  try {
    const readDiagnostics = dependencies.readDiagnostics || readQuotationDeliveryDiagnostics;
    const diagnostics = await readDiagnostics();
    return json(200, {
      worker: diagnostics.worker
        ? {
            name: diagnostics.worker.worker,
            last_run_at: diagnostics.worker.lastRunAt?.toISOString() ?? null,
            result: diagnostics.worker.result,
            processed: diagnostics.worker.processed,
            remaining: diagnostics.worker.remaining,
          }
        : null,
      message_sweep: diagnostics.messageSweep
        ? {
            last_run_at: diagnostics.messageSweep.lastRunAt.toISOString(),
            result: diagnostics.messageSweep.result,
            requeued: diagnostics.messageSweep.requeued,
            to_review: diagnostics.messageSweep.toReview,
            dispatched: diagnostics.messageSweep.dispatched,
          }
        : null,
      reconciling_steps: diagnostics.reconcilingSteps,
      pending_receipts: diagnostics.pendingReceipts,
    });
  } catch {
    return json(503, {
      error: 'Não foi possível ler o diagnóstico das entregas. Tente novamente.',
    });
  }
}

export const whatsappDeliveryDiagnostics = handler;
