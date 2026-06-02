// GET  /api/whatsapp-flows  — returns all flows + selected flow ID
// PUT  /api/whatsapp-flows  — saves flows (body: { flows, selectedFlowId })
// Storage: Vercel KV (primary), falls back to localStorage-like defaults if KV unavailable.
//
// Uses @vercel/kv which connects via KV_REST_API_URL / KV_REST_API_TOKEN env vars.
// Works on both Vercel (auto-injected) and VPS (when env vars are set in .env).

import { kv } from '@vercel/kv';
import { createHttpError } from './lib/erpnext.js';

// ── Default flows (same as frontend DEFAULT_WA_FLOWS) ───────────────────────

export const DEFAULT_WA_FLOWS = [
  {
    id: 'already-talking',
    name: 'Já estou falando com o cliente',
    description: 'Mensagem curta + PDF para conversas já iniciadas no WhatsApp.',
    vendor_name: 'Juliana',
    delay_min_seconds: 1,
    delay_max_seconds: 2,
    max_images_per_category: 0,
    default: true,
    steps: [
      { id: 'step-greeting', type: 'text', template: 'Segue o orçamento solicitado, (primeiro_nome)!' },
      { id: 'step-pdf', type: 'document', source: 'quotation_pdf', caption: 'Orçamento (numero_pedido)' },
    ],
    sample_images_text: '',
  },
  {
    id: 'email-first-contact',
    name: 'Primeiro contato — pedido veio por e-mail',
    description: 'Apresentação, contexto comercial e envio do orçamento.',
    vendor_name: 'Juliana',
    delay_min_seconds: 5,
    delay_max_seconds: 8,
    max_images_per_category: 2,
    default: false,
    steps: [
      { id: 'step-greeting', type: 'text', template: 'Boa tarde, (primeiro_nome)! Tudo bem?' },
      { id: 'step-context', type: 'text', template: 'Meu nome é (vendedora), da (empresa). Recebemos seu pedido de orçamento para (produto_resumo) personalizado(a).' },
      { id: 'step-quotation', type: 'text', template: 'Segue o orçamento (numero_pedido):\n(link_orcamento)' },
      { id: 'step-samples-intro', type: 'text', template: 'Também estou te enviando algumas fotos de referência dos modelos para você visualizar melhor as opções.' },
      { id: 'step-product-images', type: 'product_images' },
    ],
    sample_images_text: '',
  },
];

const KV_KEY_FLOWS = 'aspen:whatsapp-flows';
const KV_KEY_SELECTED = 'aspen:whatsapp-flows:selected';

// ── Helpers ─────────────────────────────────────────────────────────────────

async function readFlows() {
  if (!kv) return null;
  try {
    const [flows, selectedFlowId] = await Promise.all([
      kv.get(KV_KEY_FLOWS),
      kv.get(KV_KEY_SELECTED),
    ]);
    if (Array.isArray(flows) && flows.length > 0) {
      return { flows, selectedFlowId: selectedFlowId || flows[0]?.id || null };
    }
    return null;
  } catch (err) {
    console.warn('[whatsapp-flows] KV read failed:', err.message);
    return null;
  }
}

async function writeFlows(flows, selectedFlowId) {
  if (!kv) {
    throw createHttpError(500, 'Armazenamento não configurado.');
  }
  try {
    await Promise.all([
      kv.set(KV_KEY_FLOWS, flows),
      kv.set(KV_KEY_SELECTED, selectedFlowId),
    ]);
  } catch (err) {
    throw createHttpError(
      500,
      'Falha ao salvar fluxos.',
      `[whatsapp-flows] KV write failed: ${err.message}`
    );
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event) {
  const method = event.httpMethod || 'GET';

  // ── GET: return flows ──
  if (method === 'GET') {
    try {
      const stored = await readFlows();
      if (stored) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            flows: stored.flows,
            selectedFlowId: stored.selectedFlowId,
            source: 'kv',
          }),
        };
      }
      // KV not configured — return defaults
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          flows: DEFAULT_WA_FLOWS,
          selectedFlowId: DEFAULT_WA_FLOWS[0].id,
          source: 'defaults',
        }),
      };
    } catch (err) {
      console.error('[whatsapp-flows] GET error:', err.message);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Erro ao carregar fluxos.' }),
      };
    }
  }

  // ── PUT: save flows ──
  if (method === 'PUT') {
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'JSON inválido.' }),
      };
    }

    const { flows, selectedFlowId } = payload;
    if (!Array.isArray(flows) || flows.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Lista de fluxos inválida ou vazia.' }),
      };
    }

    try {
      await writeFlows(flows, selectedFlowId || flows[0]?.id || '');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, source: 'kv' }),
      };
    } catch (err) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[whatsapp-flows]', err?.logMessage || err?.message || err);
      return {
        statusCode: code,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err?.message || 'Erro ao salvar fluxos.' }),
      };
    }
  }

  // ── Unsupported method ──
  return {
    statusCode: 405,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Método não permitido.' }),
  };
}
