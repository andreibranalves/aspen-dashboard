// Preserved Frappe quotation + CRM Deal pipeline.

import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { runQuotePipeline } from './lib/quote-pipeline.js';
import { responseMetadata } from './orcamento-mode.js';

type LegacyQuotePipeline = typeof runQuotePipeline;

export interface LegacyHandlerDependencies {
  runQuotePipeline?: LegacyQuotePipeline;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveQuantity(value: unknown): boolean {
  const quantity = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value.trim().replace(',', '.'))
      : Number.NaN;
  return Number.isFinite(quantity) && quantity > 0;
}

function hasDisplayedRate(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value !== 'string' || value.trim() === '') return false;
  const rate = Number(value.trim().replace(',', '.'));
  return Number.isFinite(rate) && rate > 0;
}

/**
 * The legacy Frappe pipeline historically received the rate rendered in the
 * manual quote table as the effective rate. Core mode uses `manual_rate` as
 * an explicit-edit signal, so the legacy boundary promotes a valid displayed
 * rate without mutating the caller's parsed request.
 */
export function adaptLegacyExtracted(extracted: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(extracted.items)) return { ...extracted };

  const items = extracted.items.map((rawItem) => {
    if (!isRecord(rawItem)) return rawItem;
    const validItem = typeof rawItem.item_code === 'string'
      && rawItem.item_code.trim() !== ''
      && isPositiveQuantity(rawItem.qty)
      && hasDisplayedRate(rawItem.rate);
    return validItem ? { ...rawItem, manual_rate: true } : { ...rawItem };
  });

  return { ...extracted, items };
}

function withLegacyMetadata(result: FunctionResult): FunctionResult {
  if (!result.body) return result;
  try {
    const parsed = JSON.parse(result.body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        ...result,
        headers: { 'Content-Type': 'application/json', ...(result.headers || {}) },
        body: JSON.stringify({ ...parsed, ...responseMetadata('legacy') }),
      };
    }
  } catch {
    // A non-JSON legacy response is left untouched for compatibility.
  }
  return result;
}

export function createLegacyHandler(
  dependencies: LegacyHandlerDependencies = {},
): (event: FunctionEvent) => Promise<FunctionResult> {
  const quotePipeline = dependencies.runQuotePipeline || runQuotePipeline;

  return async function legacyHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(event.body);
    } catch {
      return withLegacyMetadata({ statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) });
    }

    const extracted = payload && typeof payload === 'object'
      ? payload.extracted as Record<string, unknown> | undefined
      : undefined;
    if (!extracted) {
      return withLegacyMetadata({
        statusCode: 400,
        body: JSON.stringify({ error: 'Campo "extracted" obrigatório' }),
      });
    }

    try {
      const result = await quotePipeline(
        event,
        adaptLegacyExtracted(extracted) as unknown as Parameters<typeof runQuotePipeline>[1],
      );

      // ── Fire-and-forget webhook to n8n automation engine ──
      const n8nUrl = process.env.N8N_WEBHOOK_URL;
      if (n8nUrl) {
        const webhookPayload = {
          event: 'quotation_created',
          quotation_id: result.quotation_id,
          deal_id: result.deal_id,
          nome: result.cliente,
          email: (typeof extracted.email === 'string' ? extracted.email : '').trim(),
          telefone: (typeof extracted.telefone === 'string' ? extracted.telefone : '').trim(),
          pdf_url: result.pdf_url,
        };
        fetch(n8nUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
          signal: AbortSignal.timeout(5000),
        }).catch((err: Error) =>
          console.error('[orcamento] n8n webhook failed:', err.message),
        );
      }

      return withLegacyMetadata({
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      });
    } catch (err) {
      const typedErr = err as { statusCode?: number; logMessage?: string; message?: string };
      const statusCode = Number.isInteger(typedErr?.statusCode) ? typedErr.statusCode! : 500;
      console.error('[orcamento]', typedErr?.logMessage || typedErr?.message || err);
      return withLegacyMetadata({
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Erro ao processar orçamento. Tente novamente.' }),
      });
    }
  };
}

export const handler = createLegacyHandler();
export const legacyHandler = handler;
