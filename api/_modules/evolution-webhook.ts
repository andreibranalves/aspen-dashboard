import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { isMachineBearerAuthorized } from '../_shared/machine-auth.js';
import {
  createQuotationDeliveryModule,
  QuotationDeliveryModuleInputError,
  type EvolutionMessageEvent,
  type QuotationDeliveryModule,
} from './quotation-delivery-outbox.js';
import type { EvolutionReceiptStatus } from './quotation-delivery-state.js';

export const MAX_EVOLUTION_WEBHOOK_BODY_BYTES = 64 * 1024;

const RECEIPT_STATUSES: readonly EvolutionReceiptStatus[] = [
  'ERROR',
  'PENDING',
  'SERVER_ACK',
  'DELIVERY_ACK',
  'READ',
  'PLAYED',
];

export interface EvolutionWebhookDependencies {
  deliveryModule?: Pick<QuotationDeliveryModule, 'applyEvolutionEvent'>;
  environment?: {
    EVOLUTION_WEBHOOK_SECRET?: string;
    EVOLUTION_INSTANCE?: string;
  };
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maxLength = 255): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    return '';
  }
  return normalized;
}

function normalizedEventName(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/_/g, '.') : '';
}

function parsePayload(body: string): Record<string, unknown> | null {
  if (Buffer.byteLength(body, 'utf8') > MAX_EVOLUTION_WEBHOOK_BODY_BYTES) return null;
  try {
    return record(JSON.parse(body));
  } catch {
    return null;
  }
}

function parseEvolutionEvent(
  payload: Record<string, unknown>,
  configuredInstance: string,
): EvolutionMessageEvent | null {
  const instance = text(payload.instance);
  if (!configuredInstance || !instance || instance !== configuredInstance) return null;
  if (normalizedEventName(payload.event) !== 'messages.update') return null;

  const data = record(payload.data);
  if (!data || data.fromMe !== true) return null;

  const providerMessageId = text(data.keyId);
  if (!providerMessageId) return null;

  const status = typeof data.status === 'string' ? data.status.trim() : '';
  if (!RECEIPT_STATUSES.includes(status as EvolutionReceiptStatus)) return null;

  return {
    instance,
    providerMessageId,
    fromMe: true,
    status: status as EvolutionReceiptStatus,
  };
}

export async function handler(
  event: FunctionEvent,
  dependencies: EvolutionWebhookDependencies = {},
): Promise<FunctionResult> {
  if (String(event.httpMethod || '').toUpperCase() !== 'POST') {
    return json(405, { error: 'Método não permitido.' });
  }

  const environment = dependencies.environment || process.env;
  if (!isMachineBearerAuthorized(event.headers, environment.EVOLUTION_WEBHOOK_SECRET)) {
    return json(401, { error: 'Não autorizado.' });
  }

  const body = typeof event.body === 'string' ? event.body : '';
  if (Buffer.byteLength(body, 'utf8') > MAX_EVOLUTION_WEBHOOK_BODY_BYTES) {
    return json(413, { error: 'Corpo da requisição excede o limite permitido.' });
  }

  const payload = parsePayload(body);
  if (!payload) return json(400, { error: 'Corpo do webhook inválido.' });

  const configuredInstance = text(environment.EVOLUTION_INSTANCE);
  if (!configuredInstance) return json(503, { error: 'Webhook da Evolution não configurado.' });

  const evolutionEvent = parseEvolutionEvent(payload, configuredInstance);
  if (!evolutionEvent) return json(200, { received: true, ignored: true });

  try {
    const deliveryModule = dependencies.deliveryModule || createQuotationDeliveryModule();
    await deliveryModule.applyEvolutionEvent(evolutionEvent);
    return json(200, { received: true });
  } catch (error) {
    if (error instanceof QuotationDeliveryModuleInputError) {
      return json(400, { error: error.message });
    }
    return json(503, {
      error: 'Não foi possível processar o webhook da Evolution. Tente novamente.',
    });
  }
}

export const evolutionWebhook = handler;
