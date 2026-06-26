import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { erpGetList } from './lib/erpnext.js';

// ── Helpers ──

/**
 * Ordem canônica dos estágios do pipeline.
 * Estágios não listados aparecem depois, em ordem alfabética.
 */
const PIPELINE_ORDER = [
  'Novo Lead',
  'Contato Feito',
  'Orcamento Enviado',
  'Em Negociacao',
  'Arte Aprovada',
  'Pedido Fechado',
  'Perdido',
];

function mapDeal(d) {
  return {
    id: d.name,
    lead_name: d.lead_name || 'Sem nome',
    email: d.email || null,
    telefone: d.mobile_no || null,
    status: d.status || 'Novo Lead',
    quotation: d.custom_quotation || null,
    follow_up_stage: d.custom_follow_up_stage || 0,
    next_step: d.next_step || null,
    criado_em: d.creation,
    modificado_em: d.modified,
  };
}

// ── Handler ──

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const params = event.queryStringParameters || {};
    const search = (params.search || '').trim();

    const filters = [];
    if (search) {
      filters.push(['lead_name', 'like', `%${search}%`]);
    }

    const deals = await erpGetList('CRM Deal', {
      fields: [
        'name', 'lead_name', 'email', 'mobile_no', 'status',
        'creation', 'modified', 'custom_quotation',
        'custom_follow_up_stage', 'next_step',
      ],
      filters: filters.length > 0 ? filters : undefined,
      order_by: 'modified desc',
      limit: 500,
    });

    const mapped = deals.map(mapDeal);

    // Agrupa por status
    const groups = {};
    for (const deal of mapped) {
      const s = deal.status || 'Novo Lead';
      if (!groups[s]) groups[s] = [];
      groups[s].push(deal);
    }

    // Constrói colunas na ordem do pipeline (inclui estágios vazios)
    const seen = new Set();
    const columns = [];

    // Primeiro: todos os estágios do pipeline na ordem canônica
    for (const status of PIPELINE_ORDER) {
      seen.add(status);
      columns.push({
        status,
        count: (groups[status] || []).length,
        deals: groups[status] || [],
      });
    }

    // Depois: estágios que existem mas não estão no pipeline (ordem alfabética)
    const extras = Object.keys(groups)
      .filter(s => !seen.has(s))
      .sort((a, b) => a.localeCompare(b));
    for (const status of extras) {
      columns.push({
        status,
        count: groups[status].length,
        deals: groups[status],
      });
    }

    // Totais
    const totalDeals = mapped.length;
    const stagesUsed = columns.filter(c => c.count > 0).length;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        columns,
        meta: {
          total_deals: totalDeals,
          stages: stagesUsed,
          pipeline_order: PIPELINE_ORDER,
        },
      }),
    };
  } catch (err: any) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[crm-deals]', err?.logMessage || err?.message || err);
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.statusCode ? err.message : 'Erro interno.' }),
    };
  }
}
