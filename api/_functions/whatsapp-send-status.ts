import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import {
  createQuotationDeliveryModule,
  type QuotationDeliveryModule,
} from './lib/quotation-delivery-outbox.js';
import { deliveryErrorResponse } from './quotation-deliveries.js';

export type WhatsappSendStatusDependencies = {
  deliveryModule?: QuotationDeliveryModule;
};

class HandlerInputError extends Error {
  readonly statusCode = 400;
}

function json(statusCode: number, body: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function queryValue(event: FunctionEvent, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = event.queryStringParameters?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function payloadObject(event: FunctionEvent): Record<string, unknown> {
  try {
    const value = JSON.parse(event.body || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object');
    return value as Record<string, unknown>;
  } catch {
    throw new HandlerInputError('JSON inválido.');
  }
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new HandlerInputError(`${label} inválido.`);
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 255 ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new HandlerInputError(`${label} inválido.`);
  }
  return normalized;
}

function ids(event: FunctionEvent, body: Record<string, unknown> = {}): {
  deliveryId?: string;
  revisionId?: string;
  flowId?: string;
} {
  const delivery = body.id || body.delivery_id || body.deliveryId || queryValue(event, 'id', 'delivery_id', 'deliveryId');
  if (delivery !== undefined && delivery !== null && delivery !== '') {
    return { deliveryId: identifier(delivery, 'Identificador da entrega') };
  }
  const revision = body.revision_id || body.revisionId || queryValue(event, 'revision_id', 'revisionId');
  const flow = body.flow_id || body.flowId || queryValue(event, 'flow_id', 'flowId');
  if (!revision || !flow) {
    throw new HandlerInputError('Revisão e fluxo são obrigatórios.');
  }
  return {
    revisionId: identifier(revision, 'Identificador da revisão'),
    flowId: identifier(flow, 'Fluxo'),
  };
}

function publicStatus(delivery: {
  id: string;
  revisionId: string;
  flowId: string;
  state: string;
  publicError: string | null;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    delivery_id: delivery.id,
    revision_id: delivery.revisionId,
    flow_id: delivery.flowId,
    phase: delivery.state,
    error: delivery.publicError || null,
    updated_at: delivery.updatedAt instanceof Date
      ? delivery.updatedAt.toISOString()
      : new Date(String(delivery.updatedAt)).toISOString(),
  };
}

const BODY_KEYS = new Set([
  'id',
  'delivery_id',
  'deliveryId',
  'revision_id',
  'revisionId',
  'flow_id',
  'flowId',
  'decision',
  'note',
  'resolved_by',
]);

function ensureSafeBody(body: Record<string, unknown>): void {
  if (Object.keys(body).some((key) => !BODY_KEYS.has(key))) {
    throw new HandlerInputError('A resolução aceita apenas identificadores e justificativa.');
  }
}

function decisionAndNote(body: Record<string, unknown>): {
  decision: 'confirmed_received' | 'confirmed_not_received';
  note: string;
} {
  const decision = body.decision;
  if (decision !== 'confirmed_received' && decision !== 'confirmed_not_received') {
    throw new HandlerInputError('Decisão de resolução inválida.');
  }
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (
    note.length < 3 ||
    note.length > 500 ||
    [...note].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new HandlerInputError('Justificativa inválida.');
  }
  return { decision, note };
}

export async function handler(
  event: FunctionEvent,
  dependencies: WhatsappSendStatusDependencies = {},
): Promise<FunctionResult> {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'PATCH') {
    return json(405, { error: 'Método não permitido.' });
  }
  const deliveryModule = dependencies.deliveryModule || createQuotationDeliveryModule();
  try {
    const body = event.httpMethod === 'GET' ? {} : payloadObject(event);
    if (event.httpMethod !== 'GET') ensureSafeBody(body);
    if (event.httpMethod === 'PATCH') {
      const resolution = decisionAndNote(body);
      const identity = ids(event, body);
      const delivery = identity.deliveryId
        ? await deliveryModule.get({ deliveryId: identity.deliveryId })
        : await deliveryModule.get({ identity: { revisionId: identity.revisionId!, flowId: identity.flowId! } });
      if (!delivery) return json(404, { error: 'Estado de envio não encontrado.' });
      const resolved = await deliveryModule.resolve({
        deliveryId: delivery.id,
        decision: resolution.decision,
        note: resolution.note,
        resolvedBy: 'authenticated-operator',
      });
      return json(200, publicStatus(resolved));
    }

    const identity = ids(event, body);
    const delivery = identity.deliveryId
      ? await deliveryModule.get({ deliveryId: identity.deliveryId })
      : await deliveryModule.get({ identity: { revisionId: identity.revisionId!, flowId: identity.flowId! } });
    if (!delivery) return json(404, { error: 'Estado de envio não encontrado.' });

    return json(200, publicStatus(delivery));
  } catch (error) {
    if (error instanceof HandlerInputError) return json(400, { error: error.message });
    return deliveryErrorResponse(error);
  }
}
