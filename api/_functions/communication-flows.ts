// GET /api/communication-flows — returns flows from aspen:communication:flows KV
import type { FunctionEvent, FunctionResult, JsonResponseFn } from '../_lib/types.js';
// PUT /api/communication-flows — saves flows to aspen:communication:flows KV
//
// Mirrors whatsapp-flows.js but writes to the new aspen:communication:* namespace.
// Falls back to reading old aspen:whatsapp-flows if new key is absent (migration support).
//
// Storage: Vercel KV. Keys: aspen:communication:flows, aspen:communication:flows:selected

import { kv } from '@vercel/kv';
import { createHttpError } from './lib/erpnext.js';
import { isOperationalMode } from './operational-mode.js';
import {
  KV_KEY_FLOWS,
  KV_KEY_FLOWS_SELECTED,
  createFlow,
  STEP_TYPES,
} from '../_lib/media-schema.js';

// ── Old namespace (for migration fallback) ──────────────────────────────────

const OLD_KV_KEY_FLOWS = 'aspen:whatsapp-flows';
const OLD_KV_KEY_SELECTED = 'aspen:whatsapp-flows:selected';

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

// ── Migration: convert old flow steps (image/product_images) → product_media ──

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

function migrateStep(step: Record<string, any>): Record<string, any> {
  if (!step) return step;
  const normalizedStep: Record<string, any> = {
    ...step,
    template: normalizeProductSummaryTemplate(step.template),
  };
  // Old 'product_images' → new 'product_media'
  if (normalizedStep.type === 'product_images') {
    return {
      ...normalizedStep,
      type: STEP_TYPES.PRODUCT_MEDIA,
      selection: 'product_group',
      max_items: 2,
    };
  }
  // Old 'image' with media URL → new 'product_media' (treated as fallback)
  if (normalizedStep.type === 'image') {
    return {
      ...normalizedStep,
      type: STEP_TYPES.PRODUCT_MEDIA,
      selection: 'product_group',
      max_items: 1,
    };
  }
  // Ensure every step has an id
  if (!normalizedStep.id) {
    return {
      ...normalizedStep,
      id: `step_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
    };
  }
  return normalizedStep;
}

function migrateFlow(flow: Record<string, any>): Record<string, any> {
  const migrated = createFlow({
    ...flow,
    steps: Array.isArray(flow.steps) ? flow.steps.map(migrateStep) : [],
  });
  // Ensure context field is valid
  if (!migrated.context) migrated.context = 'manual';
  if (flow.max_images_per_category !== undefined && migrated.max_media_per_product_group === 0) {
    migrated.max_media_per_product_group = flow.max_images_per_category || 0;
  }
  return migrated;
}

// ── KV helpers ─────────────────────────────────────────────────────────────

async function readFlows() {
  try {
    // Try new namespace first
    const [flows, selectedFlowId] = await Promise.all([
      kv.get(KV_KEY_FLOWS),
      kv.get(KV_KEY_FLOWS_SELECTED),
    ]);

    if (Array.isArray(flows) && flows.length > 0) {
      return {
        flows: flows.map((f) => migrateFlow(f)),
        selectedFlowId: selectedFlowId || flows[0]?.id || null,
        source: 'kv',
      };
    }

    // Migration: try old namespace
    try {
      const [oldFlows, oldSelected] = await Promise.all([
        kv.get(OLD_KV_KEY_FLOWS),
        kv.get(OLD_KV_KEY_SELECTED),
      ]);
      if (Array.isArray(oldFlows) && oldFlows.length > 0) {
        const migrated = oldFlows.map((f) => migrateFlow(f));
        // Auto-write to new namespace
        await kv.set(KV_KEY_FLOWS, migrated);
        await kv.set(KV_KEY_FLOWS_SELECTED, oldSelected || migrated[0]?.id || '');
        return {
          flows: migrated,
          selectedFlowId: oldSelected || migrated[0]?.id || null,
          source: 'kv',
        };
      }
    } catch (migrationErr: any) {
      console.warn('[communication-flows] migration read failed:', migrationErr.message);
    }

    return null; // no stored flows found
  } catch (err: any) {
    console.warn('[communication-flows] KV read failed:', err.message);
    return null;
  }
}

async function writeFlows(flows: Record<string, any>[], selectedFlowId: string): Promise<void> {
  try {
    await Promise.all([
      kv.set(KV_KEY_FLOWS, flows),
      kv.set(KV_KEY_FLOWS_SELECTED, selectedFlowId || ''),
    ]);
  } catch (err: any) {
    throw createHttpError(
      500,
      'Falha ao salvar fluxos.',
      `[communication-flows] KV write failed: ${err.message}`
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
  if (isOperationalMode()) {
    return { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'communication-flows não está disponível no modo operacional.' }) };
  }
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
    } catch (err: any) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[communication-flows]', err?.logMessage || err?.message || err);
      return jsonResponse(code, { error: err?.message || 'Erro ao carregar fluxos.' });
    }
  }

  // ── PUT: save flows ──
  if (method === 'PUT') {
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'JSON inválido.' });
    }

    const { flows, selectedFlowId } = payload;
    if (!Array.isArray(flows) || flows.length === 0) {
      return jsonResponse(400, { error: 'Lista de fluxos inválida ou vazia.' });
    }

    try {
      // Normalize each flow
      const normalized = flows.map((f, i) => createFlow({ ...f, id: f.id || `flow_${i}` }));
      await writeFlows(normalized, selectedFlowId || normalized[0]?.id || '');
      return jsonResponse(200, { success: true, source: 'kv' });
    } catch (err: any) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[communication-flows]', err?.logMessage || err?.message || err);
      return jsonResponse(code, { error: err?.message || 'Erro ao salvar fluxos.' });
    }
  }

  // ── Unsupported ──
  return jsonResponse(405, { error: 'Método não permitido.' });
}
