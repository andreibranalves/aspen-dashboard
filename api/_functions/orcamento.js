// api/_functions/orcamento.js
// Quotation creation handler — delegates to the quote-pipeline orchestrator.
// All operational logic (customer resolution, pricing, deal upsert, response assembly)
// lives in api/_functions/lib/quote-pipeline.js and its dependencies.

import { runQuotePipeline } from './lib/quote-pipeline.js';

// ── Main handler ─────────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const extracted = payload.extracted;
  if (!extracted) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Campo "extracted" obrigatório' }) };
  }

  try {
    const result = await runQuotePipeline(event, extracted);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[orcamento]', err?.logMessage || err?.message || err);
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.statusCode ? err.message : 'Erro interno.' }),
    };
  }
}
