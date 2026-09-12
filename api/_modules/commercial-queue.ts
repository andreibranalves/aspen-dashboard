import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  ActionConflictError,
  ActionNotFoundError,
  createPostgresOpportunityActionRepository,
  OpportunityActionInputError,
  OpportunityActionRepositoryError,
  type OpportunityActionCommandResult,
  type OpportunityActionHistoryEntry,
  type OpportunityActionRepository,
  type OpportunityActionScheduleInput,
  type OpportunityQueueItem,
} from '../_infrastructure/db/repositories/opportunity-actions-repository.js';

export interface CommercialQueueHandlerDependencies {
  repository?: OpportunityActionRepository;
}

class HandlerInputError extends Error {
  readonly statusCode = 400;
  readonly logMessage: string;
  constructor(message: string) {
    super(message);
    this.name = 'HandlerInputError';
    this.logMessage = message;
  }
}

const AUTHENTICATED_OPERATOR = 'authenticated-operator';

/** Commercial wording of the reason that put the action in the queue. */
const REASON_LABELS: Record<string, string> = {
  new_lead: 'Primeiro atendimento',
  manual_action: 'Ação manual',
};

const KIND_LABELS: Record<string, string> = {
  first_contact: 'Primeiro contato',
  internal: 'Ação interna',
  customer_contact: 'Contato com cliente',
  agreed_commitment: 'Compromisso acordado',
  review: 'Revisão',
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
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new HandlerInputError(`${label} inválida.`);
  }
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(body: string | undefined): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(body || '{}');
    if (!isRecord(value)) throw new Error('object');
    return value;
  } catch {
    throw new HandlerInputError('JSON inválido.');
  }
}

function textField(payload: Record<string, unknown>, name: string): string {
  const value = payload[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new HandlerInputError(`O campo ${name} é obrigatório.`);
  }
  return value.trim();
}

function optionalTime(payload: Record<string, unknown>, name = 'due_time'): string | null {
  const value = payload[name];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HandlerInputError('O horário local é inválido.');
  return value;
}

function expectedVersion(payload: Record<string, unknown>): number {
  const value = payload.expected_version;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new HandlerInputError('A versão da ação é obrigatória. Recarregue a fila.');
  }
  return Number(value);
}

function scheduleFrom(
  payload: Record<string, unknown>,
  source = payload
): OpportunityActionScheduleInput {
  return {
    kind: textField(source, 'kind') as OpportunityActionScheduleInput['kind'],
    dueDate: textField(source, 'due_date'),
    dueTime: optionalTime(source),
    reason: textField(source, 'reason'),
  };
}

function scheduleFromSuccessor(payload: Record<string, unknown>): OpportunityActionScheduleInput {
  if (!isRecord(payload.successor)) throw new HandlerInputError('A próxima ação sucessora é inválida.');
  return scheduleFrom(payload, payload.successor);
}

function closeFrom(payload: Record<string, unknown>): { reason: string } | undefined {
  if (payload.close === undefined) return undefined;
  if (!isRecord(payload.close)) throw new HandlerInputError('O fechamento da oportunidade é inválido.');
  return { reason: textField(payload.close, 'reason') };
}

function publicRecord(item: OpportunityQueueItem): Record<string, unknown> {
  return {
    action_id: item.actionId,
    opportunity_id: item.opportunityId,
    kind: item.kind,
    kind_label: KIND_LABELS[item.kind] || item.kind,
    reason_code: item.reasonCode,
    reason_label: REASON_LABELS[item.reasonCode] || item.reasonCode,
    reason: item.reason,
    origin: item.origin,
    state: item.state,
    due_at: item.dueAt,
    due_date: item.dueDate,
    due_time: item.dueTime,
    schedule_type: item.scheduleType,
    due_status: item.dueStatus,
    version: item.version,
    actor: item.actor,
    demand_summary: item.demandSummary,
    contact_name: item.contactName,
    contact_phone: item.contactPhone,
    contact_email: item.contactEmail,
    client_id: item.clientId,
    client_name: item.clientName,
    proposals: item.proposals.map((proposal) => ({
      quotation_id: proposal.quotationId,
      business_number: proposal.businessNumber,
      status: proposal.status,
      total: proposal.total,
    })),
  };
}

function publicCommand(result: OpportunityActionCommandResult): Record<string, unknown> {
  return {
    action_id: result.actionId,
    opportunity_id: result.opportunityId,
    state: result.state,
    version: result.version,
    closed: result.closed,
    successor: result.successor
      ? {
          action_id: result.successor.actionId,
          opportunity_id: result.successor.opportunityId,
          kind: result.successor.kind,
          reason: result.successor.reason,
          origin: result.successor.origin,
          state: result.successor.state,
          due_at: result.successor.dueAt,
          due_date: result.successor.dueDate,
          due_time: result.successor.dueTime,
          schedule_type: result.successor.scheduleType,
          version: result.successor.version,
        }
      : null,
  };
}

function publicHistory(entry: OpportunityActionHistoryEntry): Record<string, unknown> {
  return {
    event_id: entry.eventId,
    action_id: entry.actionId,
    type: entry.type,
    actor: entry.actor,
    timestamp: entry.timestamp,
    origin: entry.origin,
    reason: entry.reason,
    state: entry.state,
    replacement_action_id: entry.replacementActionId,
  };
}

function mapError(error: unknown, operation: 'load' | 'update'): FunctionResult {
  if (
    error instanceof HandlerInputError ||
    error instanceof OpportunityActionInputError
  ) {
    return json(400, { error: error.message });
  }
  if (error instanceof ActionNotFoundError) return json(404, { error: error.message });
  if (error instanceof ActionConflictError) return json(409, { error: error.message });
  if (error instanceof OpportunityActionRepositoryError) {
    console.error('[commercial-queue] falha ao acessar a fila', error.name);
    return json(503, { error: error.message });
  }
  console.error(
    operation === 'load'
      ? '[commercial-queue] falha ao carregar a fila'
      : '[commercial-queue] falha ao atualizar a fila',
    error instanceof Error ? error.name : typeof error
  );
  return json(503, {
    error:
      operation === 'load'
        ? 'Não foi possível carregar a fila comercial.'
        : 'Não foi possível atualizar a fila comercial.',
  });
}

/**
 * The queue endpoint owns both the read model and the small command contract.
 * It never triggers communication: these commands only persist agenda and CRM
 * continuity in PostgreSQL.
 */
export function createCommercialQueueHandler(
  dependencies: CommercialQueueHandlerDependencies = {}
): (event: FunctionEvent) => Promise<FunctionResult> {
  const repository = dependencies.repository || createPostgresOpportunityActionRepository();

  return async function commercialQueueHandler(event: FunctionEvent): Promise<FunctionResult> {
    try {
      if (event.httpMethod === 'GET') {
        const query = event.queryStringParameters || {};
        if (query.view === 'history') {
          const opportunityId = textField(query, 'opportunity_id');
          const data = await repository.listHistory(opportunityId);
          return json(200, {
            opportunity_id: opportunityId,
            data: data.map(publicHistory),
          });
        }
        const requestedPage = page(query.page, 'Página', 1);
        const pageSize = page(query.page_size, 'Tamanho da página', 25);
        const result = await repository.listActive({ page: requestedPage, pageSize });
        return json(200, {
          data: result.data.map(publicRecord),
          total: result.total,
          page: result.page,
          page_size: result.pageSize,
        });
      }

      if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Método não permitido.' }, { Allow: 'GET, POST' });
      }

      const payload = parseBody(event.body);
      const command = payload.command ?? payload.operation;
      if (typeof command !== 'string') throw new HandlerInputError('Comando da ação é obrigatório.');
      const actor = AUTHENTICATED_OPERATOR;

      if (command === 'create' || command === 'replace') {
        const opportunityId = textField(payload, 'opportunity_id');
        const input = {
          ...scheduleFrom(payload),
          opportunityId,
          actor,
          replaceActionId:
            typeof payload.replace_action_id === 'string' ? payload.replace_action_id : undefined,
          expectedVersion:
            typeof payload.expected_version === 'number' ? payload.expected_version : undefined,
        };
        const created = await repository.createAction(input);
        return json(command === 'create' && !input.replaceActionId ? 201 : 200, publicCommand(created));
      }

      if (command === 'reschedule') {
        const updated = await repository.rescheduleAction({
          ...scheduleFrom(payload),
          actionId: textField(payload, 'action_id'),
          expectedVersion: expectedVersion(payload),
          actor,
        });
        return json(200, publicCommand(updated));
      }

      if (command === 'complete') {
        const successor = payload.successor === undefined ? undefined : scheduleFromSuccessor(payload);
        const close = closeFrom(payload);
        if ((successor === undefined) === (close === undefined)) {
          throw new HandlerInputError(
            'Concluir exige criar uma ação sucessora ou fechar a oportunidade com um motivo.'
          );
        }
        const completed = await repository.completeAction({
          actionId: textField(payload, 'action_id'),
          expectedVersion: expectedVersion(payload),
          actor,
          successor,
          close,
        });
        return json(200, publicCommand(completed));
      }

      throw new HandlerInputError('Comando da ação inválido.');
    } catch (error) {
      return mapError(error, event.httpMethod === 'GET' ? 'load' : 'update');
    }
  };
}

export const handler = createCommercialQueueHandler();
