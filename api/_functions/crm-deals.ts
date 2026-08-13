import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { createHttpError } from '../_lib/http-error.js';
import {
  CRM_PIPELINE,
  createPostgresCrmDealRepository,
  type CrmDealRecord,
  type CrmDealRepository,
} from '../_db/crm-deals-repository.js';

export interface CrmDealsHandlerDependencies {
  repository?: CrmDealRepository;
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function timestamp(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

function mapDeal(deal: CrmDealRecord | Record<string, unknown>): Record<string, unknown> {
  const row = deal as Record<string, unknown>;
  const status = typeof row.status === 'string' && row.status ? row.status : 'Novo Lead';
  const followUpStage = row.followUpStage ?? row.follow_up_stage ?? 0;
  const quotationValue = row.quotation ?? row.quotationBusinessNumber ?? row.quotation_id;
  const nameValue = row.nome ?? row.lead_name;
  return {
    id: row.id,
    lead_name: typeof nameValue === 'string' && nameValue.trim() ? nameValue : 'Sem nome',
    email: row.email || null,
    telefone: row.telefone || row.mobile_no || null,
    status,
    quotation: quotationValue || null,
    follow_up_stage: followUpStage || 0,
    next_step: row.nextStep || row.next_step || null,
    criado_em: timestamp(row.createdAt ?? row.criado_em ?? row.creation),
    modificado_em: timestamp(row.updatedAt ?? row.modificado_em ?? row.modified),
  };
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) throw createHttpError(400, 'Limite inválido.');
  return Math.min(limit, 500);
}

function pipelineColumns(deals: Record<string, unknown>[]) {
  type KanbanColumn = { status: string; count: number; deals: Record<string, unknown>[] };
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const deal of deals) {
    const status = typeof deal.status === 'string' && deal.status ? deal.status : 'Novo Lead';
    const group = groups.get(status) || [];
    group.push(deal);
    groups.set(status, group);
  }

  const columns: KanbanColumn[] = CRM_PIPELINE.map((status) => ({
    status,
    count: groups.get(status)?.length || 0,
    deals: groups.get(status) || [],
  }));
  const known = new Set(CRM_PIPELINE);
  const extras = [...groups.keys()]
    .filter((status) => !known.has(status as (typeof CRM_PIPELINE)[number]))
    .sort((a, b) => a.localeCompare(b));
  for (const status of extras) {
    columns.push({ status, count: groups.get(status)!.length, deals: groups.get(status)! });
  }
  return columns;
}

export function createCrmDealsHandler(
  dependencies: CrmDealsHandlerDependencies = {}
): (event: FunctionEvent) => Promise<FunctionResult> {
  const repository = dependencies.repository || createPostgresCrmDealRepository();
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' });
    try {
      const params = event.queryStringParameters || {};
      const search = (params.search || '').trim();
      const deals = (await repository.list({ search, limit: parseLimit(params.limit) })).map(
        mapDeal
      );
      const columns = pipelineColumns(deals);
      return json(200, {
        columns,
        meta: {
          total_deals: deals.length,
          stages: columns.filter((column) => column.count > 0).length,
          pipeline_order: CRM_PIPELINE,
        },
      });
    } catch (error) {
      const httpError = error as { statusCode?: number; message?: string; logMessage?: string };
      const statusCode = Number.isInteger(httpError.statusCode) ? httpError.statusCode! : 500;
      console.error('[crm-deals]', httpError.logMessage || httpError.message || error);
      return json(statusCode, {
        error: httpError.statusCode ? httpError.message : 'Erro interno.',
      });
    }
  };
}

export const handler = createCrmDealsHandler();
