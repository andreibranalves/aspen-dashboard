// api/_functions/orcamento.ts
// Quotation creation handler — delegates to the quote-pipeline orchestrator.
// All operational logic (customer resolution, pricing, deal upsert, response assembly)
// lives in api/_functions/lib/quote-pipeline.js and its dependencies.

import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { runQuotePipeline } from './lib/quote-pipeline.js';

// ── Main handler ─────────────────────────────────────────────────────────────

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const extracted = payload.extracted as Record<string, unknown> | undefined;
  if (!extracted) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Campo "extracted" obrigatório' }) };
  }

  try {
    const result = await runQuotePipeline(
      event,
      extracted as unknown as Parameters<typeof runQuotePipeline>[1],
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

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    const typedErr = err as { statusCode?: number; logMessage?: string; message?: string };
    const statusCode = Number.isInteger(typedErr?.statusCode) ? typedErr.statusCode! : 500;
    console.error('[orcamento]', typedErr?.logMessage || typedErr?.message || err);
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: typedErr?.statusCode ? typedErr.message : 'Erro interno.' }),
    };
  }
}
