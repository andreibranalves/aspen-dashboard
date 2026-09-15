import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { addBusinessDays, calendarDateInSaoPaulo } from '../_shared/calendar-sao-paulo.js';
import {
  ActionConflictError,
  ActionNotFoundError,
  createPostgresOpportunityActionRepository,
  OpportunityActionInputError,
  OpportunityActionRepositoryError,
  isStrictIsoTimestamp,
  type OpportunityActionCommandResult,
  type OpportunityActionHistoryEntry,
  type OpportunityActionRepository,
  type OpportunityActionScheduleInput,
  type ManualContactCommandResult,
  type ManualContactContinuationType,
  type ManualContactResultCode,
  type ManualContactType,
  type OpportunityQueueFilter,
  type OpportunityQueueItem,
  type FollowUpContinuityType,
} from '../_infrastructure/db/repositories/opportunity-actions-repository.js';
import {
  createPostgresWhatsappContactActivityRepository,
  type WhatsappContactActivityRepository,
} from '../_infrastructure/db/repositories/whatsapp-contact-activity-repository.js';

export interface CommercialQueueHandlerDependencies {
  repository?: OpportunityActionRepository;
  contactRepository?: Pick<WhatsappContactActivityRepository, 'unblockContact'>;
  environment?: NodeJS.ProcessEnv;
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
  proposal_delivery_confirmed: 'Entrega confirmada da proposta',
  follow_up_second_return: 'Segundo retorno',
  follow_up_decide_continuity: 'Decidir continuidade',
  inbound_needs_response: 'Preciso responder',
  associate_response: 'Associar resposta',
  verify_conversation: 'Verificar conversa',
};

const KIND_LABELS: Record<string, string> = {
  first_contact: 'Primeiro contato',
  internal: 'Ação interna',
  customer_contact: 'Contato com cliente',
  agreed_commitment: 'Compromisso acordado',
  review: 'Revisão',
};

const MANUAL_CONTACT_RESULT_LABELS: Record<string, string> = {
  follow_up_agreed: 'Próximo passo combinado',
  interested: 'Interessado',
  not_interested: 'Sem interesse',
  no_response: 'Sem resposta',
  awaiting_information: 'Aguardando informação',
  wrong_contact: 'Contato incorreto',
  other: 'Outro resultado',
};

const QUEUE_FILTERS: readonly OpportunityQueueFilter[] = [
  'active',
  'overdue',
  'today',
  'scheduled',
  'closed',
];

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

function queueFilter(value: unknown): OpportunityQueueFilter {
  const candidate = value === undefined || value === '' ? 'active' : value;
  if (candidate === 'all') return 'active';
  if (
    typeof candidate !== 'string' ||
    !QUEUE_FILTERS.includes(candidate as OpportunityQueueFilter)
  ) {
    throw new HandlerInputError('Filtro da fila inválido.');
  }
  return candidate as OpportunityQueueFilter;
}

function followUpBusinessDays(value: unknown): 2 | 3 {
  if (value !== '2' && value !== '3') {
    throw new HandlerInputError('A quantidade de dias úteis é inválida.');
  }
  return Number(value) as 2 | 3;
}

function followUpSuggestion(query: Record<string, string | undefined>): FunctionResult {
  const occurredAt = query.occurred_at;
  if (!isStrictIsoTimestamp(occurredAt)) {
    throw new HandlerInputError('A data e hora do contato são inválidas.');
  }
  const businessDays = followUpBusinessDays(query.business_days);
  const anchorDate = calendarDateInSaoPaulo(new Date(occurredAt));
  return json(200, {
    anchor_date: anchorDate,
    suggested_date: addBusinessDays(anchorDate, businessDays),
    business_days: businessDays,
  });
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
  if (!isRecord(payload.successor))
    throw new HandlerInputError('A próxima ação sucessora é inválida.');
  return scheduleFrom(payload, payload.successor);
}

function closeFrom(payload: Record<string, unknown>): { reason: string } | undefined {
  if (payload.close === undefined) return undefined;
  if (!isRecord(payload.close))
    throw new HandlerInputError('O fechamento da oportunidade é inválido.');
  return { reason: textField(payload.close, 'reason') };
}

function manualContactContinuationFrom(payload: Record<string, unknown>): {
  type: ManualContactContinuationType;
  schedule?: OpportunityActionScheduleInput;
  reason?: string;
} {
  const value = payload.continuation;
  if (!isRecord(value)) {
    throw new HandlerInputError(
      'O contato manual exige uma continuidade: próxima ação, espera ou fechamento.'
    );
  }
  const type = value.type;
  if (type !== 'successor' && type !== 'wait' && type !== 'close') {
    throw new HandlerInputError('A continuidade do contato manual é inválida.');
  }
  if (type === 'close') {
    const reason = value.reason ?? value.close_reason;
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new HandlerInputError('O motivo do fechamento é obrigatório.');
    }
    return { type, reason: reason.trim() };
  }
  const source = isRecord(value.schedule) ? value.schedule : value;
  return { type, schedule: scheduleFrom(payload, source) };
}

function manualContactFrom(payload: Record<string, unknown>) {
  const continuation = manualContactContinuationFrom(payload);
  const contactType = textField(payload, 'contact_type') as ManualContactType;
  const resultCode = textField(payload, 'result_code') as ManualContactResultCode;
  const occurredAt = textField(payload, 'occurred_at');
  if (!isStrictIsoTimestamp(occurredAt)) {
    throw new HandlerInputError('A data e hora do contato são inválidas.');
  }
  const commandId = textField(payload, 'command_id');
  const counted = payload.counts_as_follow_up;
  if (typeof counted !== 'boolean') {
    throw new HandlerInputError('A marcação de follow-up concluído é obrigatória.');
  }
  const note = payload.note;
  if (note !== undefined && note !== null && typeof note !== 'string') {
    throw new HandlerInputError('A observação do contato é inválida.');
  }
  return {
    commandId,
    opportunityId: textField(payload, 'opportunity_id'),
    actionId: textField(payload, 'action_id'),
    expectedVersion: expectedVersion(payload),
    contactType,
    occurredAt,
    note: note as string | null | undefined,
    resultCode,
    countsAsFollowUp: counted,
    actor: AUTHENTICATED_OPERATOR,
    continuation:
      continuation.type === 'close'
        ? { type: 'close' as const, reason: continuation.reason! }
        : { type: continuation.type, schedule: continuation.schedule! },
  };
}

function continueFollowUpFrom(payload: Record<string, unknown>) {
  const type = payload.continuity_type ?? payload.type;
  if (type !== 'new_cycle' && type !== 'manual_date') {
    throw new HandlerInputError('A decisão de continuidade é inválida.');
  }
  return {
    commandId: textField(payload, 'command_id'),
    opportunityId: textField(payload, 'opportunity_id'),
    actionId: textField(payload, 'action_id'),
    expectedVersion: expectedVersion(payload),
    type: type as FollowUpContinuityType,
    schedule: { ...scheduleFrom(payload), origin: 'manual' as const },
    actor: AUTHENTICATED_OPERATOR,
  };
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
    is_urgent: item.isUrgent,
    priority: item.priority,
    follow_up_stage: item.followUpStage,
    opportunity_status: item.opportunityStatus,
    terminal_status: item.terminalStatus,
    terminal_reason: item.terminalReason,
    terminal_at: item.terminalAt,
    contact_context: {
      status: item.contactContext.status,
      last_contact_at: item.contactContext.lastContactAt,
      last_contact_direction: item.contactContext.lastContactDirection,
      blockers: item.contactContext.blockers,
    },
    last_contact_at: item.contactContext.lastContactAt,
    last_contact_direction: item.contactContext.lastContactDirection,
    blockers: item.contactContext.blockers,
    whatsapp_href: item.whatsappHref,
    demand_summary: item.demandSummary,
    contact_name: item.contactName,
    contact_phone: item.contactPhone,
    contact_email: item.contactEmail,
    client_id: item.clientId,
    client_name: item.clientName,
    source_quotation_id: item.sourceQuotationId,
    source_revision_id: item.sourceRevisionId,
    source_delivery_id: item.sourceDeliveryId,
    proposals: item.proposals.map((proposal) => ({
      quotation_id: proposal.quotationId,
      business_number: proposal.businessNumber,
      status: proposal.status,
      total: proposal.total,
    })),
    association_candidates: item.associationCandidates.map((candidate) => ({
      opportunity_id: candidate.opportunityId,
      demand_summary: candidate.demandSummary,
    })),
  };
}

function publicUrgency(result: {
  opportunityId: string;
  actionId: string;
  version: number;
  isUrgent: boolean;
}): Record<string, unknown> {
  return {
    opportunity_id: result.opportunityId,
    action_id: result.actionId,
    version: result.version,
    is_urgent: result.isUrgent,
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

function publicManualContact(result: ManualContactCommandResult): Record<string, unknown> {
  return {
    ...publicCommand(result),
    event_id: result.eventId,
    command_id: result.commandId,
    contact_type: result.contactType,
    occurred_at: result.occurredAt,
    note: result.note,
    result_code: result.resultCode,
    result_label: MANUAL_CONTACT_RESULT_LABELS[result.resultCode] || result.resultCode,
    counts_as_follow_up: result.countsAsFollowUp,
    continuation_type: result.continuationType,
    source: result.source,
  };
}

function publicHistory(entry: OpportunityActionHistoryEntry): Record<string, unknown> {
  const result: Record<string, unknown> = {
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
  if (entry.type === 'manual_contact') {
    result.contact_type = entry.contactType;
    result.occurred_at = entry.occurredAt;
    result.note = entry.note ?? null;
    result.result_code = entry.resultCode;
    result.result_label = MANUAL_CONTACT_RESULT_LABELS[entry.resultCode || ''] || entry.resultCode;
    result.counts_as_follow_up = entry.countsAsFollowUp;
    result.source = entry.source;
    result.continuation_type = entry.continuationType;
    result.successor_action_id = entry.successorActionId ?? null;
    result.close_reason = entry.closeReason ?? null;
  }
  return result;
}

function mapError(error: unknown, operation: 'load' | 'update'): FunctionResult {
  if (error instanceof HandlerInputError || error instanceof OpportunityActionInputError) {
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
  const contactRepository =
    dependencies.contactRepository || createPostgresWhatsappContactActivityRepository();
  const environment = dependencies.environment || process.env;

  return async function commercialQueueHandler(event: FunctionEvent): Promise<FunctionResult> {
    try {
      if (event.httpMethod === 'GET') {
        const query = event.queryStringParameters || {};
        if (query.view === 'follow_up_suggestion') return followUpSuggestion(query);
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
        const filter = queueFilter(query.filter ?? query.view);
        const result = await repository.listActive({ page: requestedPage, pageSize, filter });
        return json(200, {
          data: result.data.map(publicRecord),
          total: result.total,
          page: result.page,
          page_size: result.pageSize,
          filter,
        });
      }

      if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Método não permitido.' }, { Allow: 'GET, POST' });
      }

      const payload = parseBody(event.body);
      const command = payload.command ?? payload.operation;
      if (typeof command !== 'string')
        throw new HandlerInputError('Comando da ação é obrigatório.');
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
        return json(
          command === 'create' && !input.replaceActionId ? 201 : 200,
          publicCommand(created)
        );
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
        const successor =
          payload.successor === undefined ? undefined : scheduleFromSuccessor(payload);
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

      if (command === 'manual_contact' || command === 'record_manual_contact') {
        const recorded = await repository.recordManualContact(manualContactFrom(payload));
        return json(200, publicManualContact(recorded));
      }

      if (command === 'continue_follow_up' || command === 'follow_up_continuity') {
        const continued = await repository.continueFollowUp(continueFollowUpFrom(payload));
        return json(200, publicCommand(continued));
      }

      if (command === 'set_urgency' || command === 'set_urgent') {
        const isUrgent = payload.is_urgent;
        if (typeof isUrgent !== 'boolean') {
          throw new HandlerInputError('O estado de urgência é obrigatório.');
        }
        const updated = await repository.setUrgency({
          opportunityId: textField(payload, 'opportunity_id'),
          actionId: textField(payload, 'action_id'),
          expectedVersion: expectedVersion(payload),
          isUrgent,
          actor,
        });
        return json(200, publicUrgency(updated));
      }

      if (command === 'unblock_contact') {
        const instance = String(environment.EVOLUTION_INSTANCE || '').trim();
        if (!instance) throw new HandlerInputError('WhatsApp não configurado.');
        const canonicalPhone = textField(payload, 'canonical_phone');
        if (!/^[0-9]{10,15}$/.test(canonicalPhone)) {
          throw new HandlerInputError('Telefone inválido.');
        }
        const reason = textField(payload, 'reason');
        if (reason.length > 500) throw new HandlerInputError('O motivo deve ter no máximo 500 caracteres.');
        await contactRepository.unblockContact({
          instance,
          canonicalPhone,
          actor,
          reason,
        });
        return json(200, { unblocked: true, canonical_phone: canonicalPhone });
      }

      if (command === 'associate_inbound' || command === 'associate_response') {
        const associated = await repository.associateInboundResponse({
          opportunityId: textField(payload, 'opportunity_id'),
          actionId: textField(payload, 'action_id'),
          expectedVersion: expectedVersion(payload),
          actor,
        });
        return json(200, publicCommand(associated));
      }

      throw new HandlerInputError('Comando da ação inválido.');
    } catch (error) {
      return mapError(error, event.httpMethod === 'GET' ? 'load' : 'update');
    }
  };
}

export const handler = createCommercialQueueHandler();
