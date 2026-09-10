import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { createHttpError } from '../_shared/http-error.js';
import {
  createPostgresCrmDealRepository,
  type CrmDealRecord,
  type CrmDealRepository,
} from '../_infrastructure/db/repositories/crm-deals-repository.js';
import {
  createPostgresCrmPipelineStageRepository,
  type CrmPipelineStage,
  type CrmPipelineStageRepository,
} from '../_infrastructure/db/repositories/crm-pipeline-stages-repository.js';

export interface CrmDealsHandlerDependencies {
  repository?: CrmDealRepository;
  pipelineRepository?: CrmPipelineStageRepository;
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
  const nameValue = row.nome ?? row.lead_name;
  return {
    id: row.id,
    client_id: row.clientId ?? row.client_id ?? null,
    quote_lead_id: row.quoteLeadId ?? row.quote_lead_id ?? null,
    ...((row.leadSource ?? row.lead_source)
      ? { lead_source: row.leadSource ?? row.lead_source }
      : {}),
    quotation_id: row.quotationId ?? null,
    lead_name: typeof nameValue === 'string' && nameValue.trim() ? nameValue : 'Sem nome',
    email: row.email || null,
    telefone: row.telefone || row.mobile_no || null,
    status,
    quotation: row.quotation ?? row.quotationBusinessNumber ?? null,
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

function pipelineColumns(deals: Record<string, unknown>[], stages: CrmPipelineStage[]) {
  type KanbanColumn = {
    status: string;
    name: string;
    count: number;
    deals: Record<string, unknown>[];
  };
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const deal of deals) {
    const status = typeof deal.status === 'string' && deal.status ? deal.status : 'Novo Lead';
    const group = groups.get(status) || [];
    group.push(deal);
    groups.set(status, group);
  }

  const columns: KanbanColumn[] = stages.map((stage) => ({
    status: stage.key,
    name: stage.name,
    count: groups.get(stage.key)?.length || 0,
    deals: groups.get(stage.key) || [],
  }));
  const known = new Set(stages.map((stage) => stage.key));
  const extras = [...groups.keys()]
    .filter((status) => !known.has(status))
    .sort((a, b) => a.localeCompare(b));
  for (const status of extras) {
    columns.push({
      status,
      name: status,
      count: groups.get(status)!.length,
      deals: groups.get(status)!,
    });
  }
  return columns;
}

export function createCrmDealsHandler(
  dependencies: CrmDealsHandlerDependencies = {}
): (event: FunctionEvent) => Promise<FunctionResult> {
  const repository = dependencies.repository || createPostgresCrmDealRepository();
  const pipelineRepository =
    dependencies.pipelineRepository || createPostgresCrmPipelineStageRepository();
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' });
    try {
      const params = event.queryStringParameters || {};
      const search = (params.search || '').trim();
      const [dealRows, stages] = await Promise.all([
        repository.list({ search, limit: parseLimit(params.limit) }),
        pipelineRepository.list(),
      ]);
      const deals = dealRows.map(mapDeal);
      const columns = pipelineColumns(deals, stages);
      return json(200, {
        columns,
        meta: {
          total_deals: deals.length,
          stages: columns.filter((column) => column.count > 0).length,
          pipeline_order: stages.map((stage) => stage.key),
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
