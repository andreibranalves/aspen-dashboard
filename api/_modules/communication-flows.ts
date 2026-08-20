// GET /api/communication-flows — returns flows from aspen:communication:flows KV
import type { FunctionEvent, FunctionResult, JsonResponseFn } from '../_http/types.js';
// PUT /api/communication-flows — saves flows to aspen:communication:flows KV
//
// Stores flow definitions in the local aspen:communication:* namespace.
//
// Storage: Vercel KV. Keys: aspen:communication:flows, aspen:communication:flows:selected

import { getKvClient } from '../_infrastructure/integrations/kv/client.js';
import { createHttpError } from '../_shared/http-error.js';
import {
  KV_KEY_FLOWS,
  KV_KEY_FLOWS_SELECTED,
  createFlow,
  QUOTATION_OUTPUTS,
  STEP_TYPES,
} from './media-schema.js';

const kv = getKvClient();

type FlowRecord = Record<string, unknown>;

function isRecord(value: unknown): value is FlowRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorDetails(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

// ── Default flows (matching DEFAULT_WA_FLOWS but with product_media) ────────

const DEFAULT_FLOWS = [
  {
    id: 'already-talking',
    name: 'Já estou falando com o cliente',
    description: 'Mensagem curta + PDF para conversas já iniciadas no WhatsApp.',
    context: 'already_talking',
    channel: 'whatsapp',
    vendor_name: 'Juliana',
    delay_min_seconds: 1,
    delay_max_seconds: 2,
    max_media_per_product_group: 0,
    enabled: true,
    steps: [
      {
        id: 'step-greeting',
        type: 'text',
        template: 'Segue o orçamento solicitado, (primeiro_nome)!',
      },
      {
        id: 'step-pdf',
        type: 'document',
        source: 'quotation_pdf',
        caption: 'Orçamento (numero_pedido)',
      },
    ],
  },
  {
    id: 'email-first-contact',
    name: 'Primeiro contato — pedido veio por e-mail',
    description: 'Apresentação, contexto comercial e envio do orçamento com mídia.',
    context: 'email_first_contact',
    channel: 'whatsapp',
    vendor_name: 'Juliana',
    delay_min_seconds: 5,
    delay_max_seconds: 8,
    max_media_per_product_group: 1,
    enabled: true,
    steps: [
      { id: 'step-greeting', type: 'text', template: '(Saudacao), (primeiro_nome)! Tudo bem?' },
      {
        id: 'step-context',
        type: 'text',
        template:
          'Meu nome é (vendedora), da (empresa). Recebemos seu pedido de orçamento para (produto_resumo) (produto_adjetivo_personalizado).',
      },
      {
        id: 'step-quotation',
        type: 'text',
        template: 'Segue o orçamento (numero_pedido):\n(link_orcamento)',
      },
      {
        id: 'step-media-intro',
        type: 'text',
        template:
          'Separei também uma referência de (grupo_produto) para você visualizar melhor o acabamento.',
      },
      { id: 'step-product-media', type: 'product_media', selection: 'product_group', max_items: 1 },
    ],
  },
];

// ── Flow sanitization ───────────────────────────────────────────────────────

function normalizeProductSummaryTemplate(template: unknown): string {
  return typeof template === 'string'
    ? template
        .replace(
          /\(produto_resumo\)\s+personalizado\(a\)/g,
          '(produto_resumo) (produto_adjetivo_personalizado)'
        )
        .replace(
          /\(produto_resumo\)\s+personalizados\(as\)/g,
          '(produto_resumo) (produto_adjetivo_personalizado)'
        )
    : String(template || '');
}

function migrateStep(value: unknown): FlowRecord | null {
  const step = isRecord(value) ? value : null;
  const type = typeof step?.type === 'string' ? step.type : '';
  if (!step || !['text', STEP_TYPES.DOCUMENT, STEP_TYPES.PRODUCT_MEDIA].includes(type)) {
    return null;
  }
  const normalized: FlowRecord = {
    ...step,
    template: normalizeProductSummaryTemplate(step.template),
    id: step.id || `step_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
  };
  if (
    normalized.type === STEP_TYPES.DOCUMENT &&
    !QUOTATION_OUTPUTS.includes(normalized.source as (typeof QUOTATION_OUTPUTS)[number])
  ) {
    return null;
  }
  return normalized;
}

function migrateFlow(value: unknown): FlowRecord | null {
  const flow = isRecord(value) ? value : null;
  if (!flow) return null;
  const migrated = createFlow({
    ...flow,
    steps: Array.isArray(flow.steps)
      ? flow.steps.map(migrateStep).filter((step): step is FlowRecord => step !== null)
      : [],
  });
  if (!migrated.context) migrated.context = 'manual';
  return migrated;
}

// ── KV helpers ─────────────────────────────────────────────────────────────

async function readFlows() {
  try {
    const [flows, selectedFlowId] = await Promise.all([
      kv.get(KV_KEY_FLOWS) as Promise<unknown>,
      kv.get(KV_KEY_FLOWS_SELECTED) as Promise<unknown>,
    ]);
    if (!Array.isArray(flows) || flows.length === 0) return null;
    const normalized = flows
      .map(migrateFlow)
      .filter((flow): flow is FlowRecord => flow !== null);
    if (normalized.length === 0) return null;
    const storedSelectedFlowId = typeof selectedFlowId === 'string' ? selectedFlowId : '';
    const firstFlowId = typeof normalized[0]?.id === 'string' ? normalized[0].id : null;
    return {
      flows: normalized,
      selectedFlowId: storedSelectedFlowId || firstFlowId,
      source: 'kv',
    };
  } catch (err: unknown) {
    const details = errorDetails(err);
    console.warn('[communication-flows] KV read failed:', details.message || err);
    return null;
  }
}

async function writeFlows(flows: FlowRecord[], selectedFlowId: string): Promise<void> {
  try {
    await Promise.all([
      kv.set(KV_KEY_FLOWS, flows),
      kv.set(KV_KEY_FLOWS_SELECTED, selectedFlowId || ''),
    ]);
  } catch (err: unknown) {
    const details = errorDetails(err);
    throw createHttpError(
      500,
      'Falha ao salvar fluxos.',
      `[communication-flows] KV write failed: ${String(details.message || err)}`
    );
  }
}

// ── JSON response helper ───────────────────────────────────────────────────

const jsonResponse: JsonResponseFn = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  const method = event.httpMethod || 'GET';

  // ── GET: return flows ──
  if (method === 'GET') {
    try {
      const stored = await readFlows();
      if (stored) {
        return jsonResponse(200, {
          success: true,
          flows: stored.flows,
          selectedFlowId: stored.selectedFlowId,
          source: stored.source,
        });
      }

      // No stored flows — return defaults
      return jsonResponse(200, {
        success: true,
        flows: DEFAULT_FLOWS.map((f) => createFlow(f)),
        selectedFlowId: DEFAULT_FLOWS[0].id,
        source: 'defaults',
      });
    } catch (err: unknown) {
      const details = errorDetails(err);
      const code = Number.isInteger(details.statusCode) ? Number(details.statusCode) : 500;
      const message = typeof details.message === 'string' ? details.message : 'Erro ao carregar fluxos.';
      console.error('[communication-flows]', details.logMessage || details.message || err);
      return jsonResponse(code, { error: message });
    }
  }

  // ── PUT: save flows ──
  if (method === 'PUT') {
    let payload: FlowRecord;
    try {
      const parsed: unknown = JSON.parse(event.body || '{}');
      payload = isRecord(parsed) ? parsed : {};
    } catch {
      return jsonResponse(400, { error: 'JSON inválido.' });
    }

    const flows = payload.flows;
    const selectedFlowId = typeof payload.selectedFlowId === 'string' ? payload.selectedFlowId : '';
    if (!Array.isArray(flows) || flows.length === 0) {
      return jsonResponse(400, { error: 'Lista de fluxos inválida ou vazia.' });
    }

    try {
      // Normalize each flow
      const normalized = flows
        .map((value, index) => {
          const flow = isRecord(value) ? value : {};
          const id = typeof flow.id === 'string' && flow.id ? flow.id : `flow_${index}`;
          return migrateFlow({ ...flow, id });
        })
        .filter((flow): flow is FlowRecord => flow !== null);
      if (normalized.length === 0) {
        return jsonResponse(400, { error: 'Lista de fluxos inválida ou vazia.' });
      }
      await writeFlows(normalized, selectedFlowId || String(normalized[0]?.id || ''));
      return jsonResponse(200, { success: true, source: 'kv' });
    } catch (err: unknown) {
      const details = errorDetails(err);
      const code = Number.isInteger(details.statusCode) ? Number(details.statusCode) : 500;
      const message = typeof details.message === 'string' ? details.message : 'Erro ao salvar fluxos.';
      console.error('[communication-flows]', details.logMessage || details.message || err);
      return jsonResponse(code, { error: message });
    }
  }

  // ── Unsupported ──
  return jsonResponse(405, { error: 'Método não permitido.' });
}
