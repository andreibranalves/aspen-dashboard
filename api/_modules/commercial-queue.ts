import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  createPostgresOpportunityActionRepository,
  OpportunityActionInputError,
  type OpportunityQueueItem,
  type OpportunityActionRepository,
} from '../_infrastructure/db/repositories/opportunity-actions-repository.js';

export interface CommercialQueueHandlerDependencies {
  repository?: OpportunityActionRepository;
}

class HandlerInputError extends Error {
  readonly statusCode = 400;
}

/** Commercial wording of the reason that put the action in the queue. */
const REASON_LABELS: Record<string, string> = {
  new_lead: 'Primeiro atendimento',
};

function json(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {}
): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
    body: JSON.stringify(body),
  };
}

function page(value: string | undefined, label: string, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw new HandlerInputError(`${label} inválida.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new HandlerInputError(`${label} inválida.`);
  return number;
}

function publicRecord(item: OpportunityQueueItem): Record<string, unknown> {
  return {
    action_id: item.actionId,
    opportunity_id: item.opportunityId,
    kind: item.kind,
    reason_code: item.reasonCode,
    reason_label: REASON_LABELS[item.reasonCode] || item.reasonCode,
    origin: item.origin,
    state: item.state,
    due_at: item.dueAt,
    demand_summary: item.demandSummary,
    contact_name: item.contactName,
    contact_phone: item.contactPhone,
    contact_email: item.contactEmail,
    client_id: item.clientId,
    client_name: item.clientName,
  };
}

function mapError(error: unknown): FunctionResult {
  if (error instanceof HandlerInputError || error instanceof OpportunityActionInputError) {
    return json(400, { error: error.message });
  }
  console.error(
    '[commercial-queue] falha ao carregar a fila',
    error instanceof Error ? error.name : typeof error
  );
  return json(503, { error: 'Não foi possível carregar a fila comercial.' });
}

/**
 * Read-only contract of the commercial queue. It never mutates state and never
 * triggers external communication; the legacy follow-up queue keeps its own
 * endpoint.
 */
export function createCommercialQueueHandler(
  dependencies: CommercialQueueHandlerDependencies = {}
): (event: FunctionEvent) => Promise<FunctionResult> {
  const repository = dependencies.repository || createPostgresOpportunityActionRepository();

  return async function commercialQueueHandler(event: FunctionEvent): Promise<FunctionResult> {
    try {
      if (event.httpMethod !== 'GET') {
        return json(405, { error: 'Método não permitido.' }, { Allow: 'GET' });
      }
      const requestedPage = page(event.queryStringParameters?.page, 'Página', 1);
      const pageSize = page(event.queryStringParameters?.page_size, 'Tamanho da página', 25);
      const result = await repository.listActive({ page: requestedPage, pageSize });
      return json(200, {
        data: result.data.map(publicRecord),
        total: result.total,
        page: result.page,
        page_size: result.pageSize,
      });
    } catch (error) {
      return mapError(error);
    }
  };
}

export const handler = createCommercialQueueHandler();
