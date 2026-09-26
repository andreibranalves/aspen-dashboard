import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { createPostgresQuotationFollowUpRepository } from '../_infrastructure/db/repositories/quotation-follow-up-repository.js';
import { createPostgresWhatsappContactActivityRepository, type WhatsappContactActivityRepository } from '../_infrastructure/db/repositories/whatsapp-contact-activity-repository.js';
import { isMachineBearerAuthorized } from '../_shared/machine-auth.js';
import {
  createQuotationDeliveryModule,
  QuotationDeliveryModuleInputError,
  type EvolutionMessageEvent,
  type QuotationDeliveryModule,
} from './quotation-delivery-outbox.js';
import { resolveWhatsappIdentity } from './whatsapp-identity-resolver.js';
import {
  ingestWhatsappUpserts,
  type WhatsappUpsertIngestionItem,
} from './whatsapp-attendance-ingestion.js';
import type { WhatsappAttendanceRepository } from '../_infrastructure/db/repositories/whatsapp-attendance-repository.js';
import {
  createPostgresWhatsappWebhookEffectsRepository,
  type WebhookEffectRecord,
  type WhatsappWebhookEffectsRepository,
} from '../_infrastructure/db/repositories/whatsapp-webhook-effects-repository.js';
import { applyWebhookEffects, createWebhookEffectRunners } from './whatsapp-webhook-effects.js';
import {
  createPostgresWhatsappMessageOutboxRepository,
  type WhatsappMessageOutboxRepository,
} from '../_infrastructure/db/repositories/whatsapp-message-outbox-repository.js';
import type { EvolutionReceiptStatus } from './quotation-delivery-state.js';
import { safeErrorSummary } from '../_shared/safe-error.js';
export const MAX_EVOLUTION_WEBHOOK_BODY_BYTES = 64 * 1024;

const RECEIPT_STATUSES: readonly EvolutionReceiptStatus[] = [
  'ERROR',
  'PENDING',
  'SERVER_ACK',
  'DELIVERY_ACK',
  'READ',
  'PLAYED',
];

interface FollowUpConversationInput {
  instance: string;
  providerConversationId: string;
  providerMessageId: string;
  fromMe: boolean;
  occurredAt: Date;
  identityStatus: 'verified' | 'derived' | 'unresolved' | 'conflict';
  canonicalPhone: string | null;
}

type FollowUpConversationRepository = {
  applyConversationToOpenFollowUps(input: FollowUpConversationInput): Promise<void>;
};

export interface EvolutionWebhookDependencies {
  deliveryModule?: Pick<QuotationDeliveryModule, 'applyEvolutionEvent'>;
  activityRepository?: Pick<
    WhatsappContactActivityRepository,
    'recordActivity' | 'getHealth' | 'blockIngestion' | 'unblockIngestionIfEvent' | 'markIngestion'
  >;
  followUpRepository?: FollowUpConversationRepository;
  attendanceRepository?: Pick<WhatsappAttendanceRepository, 'ingestConversation'>;
  effectsRepository?: Pick<WhatsappWebhookEffectsRepository, 'register' | 'markDone' | 'markFailed'>;
  outboxRepository?: Pick<WhatsappMessageOutboxRepository, 'applyReceipts'>;
  environment?: {
    EVOLUTION_WEBHOOK_SECRET?: string;
    EVOLUTION_INSTANCE?: string;
  };
  now?: () => Date;
}

/**
 * What the webhook recorded before answering. `afterResponse` applies what can
 * wait for the acknowledgement (message effects, the receipt projection) and
 * resolves false when an effect failed and stays pending.
 */
export interface EvolutionWebhookOutcome {
  response: FunctionResult;
  afterResponse?: () => Promise<boolean>;
}

const RECORD_FAILURE = 'Não foi possível registrar a mensagem recebida da Evolution. Tente novamente.';

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

function readKey(value: Record<string, unknown>): Record<string, unknown> {
  return record(value.key) || {};
}

function readMessageId(value: Record<string, unknown>): string {
  const key = readKey(value);
  return text(value.keyId) || text(key.id);
}

function readRemoteJid(value: Record<string, unknown>): string {
  const key = readKey(value);
  return text(value.remoteJid) || text(key.remoteJid);
}

function readFromMe(value: Record<string, unknown>): boolean | null {
  const key = readKey(value);
  if (typeof value.fromMe === 'boolean') return value.fromMe;
  if (typeof key.fromMe === 'boolean') return key.fromMe;
  return null;
}

function parseMessageTimestamp(value: unknown, fallback: Date): Date {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 1e12 ? value * 1000 : value;
    const parsed = new Date(milliseconds);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function isIgnoredRemoteJid(remoteJid: string): boolean {
  const normalized = remoteJid.toLowerCase();
  return normalized.endsWith('@g.us') || normalized.endsWith('@broadcast') || normalized === 'status@broadcast';
}

function eventKey(instance: string, index: number, providerMessageId: string): string {
  return `${instance}:upsert:${index}:${providerMessageId || 'unparsed'}`;
}

interface ParsedUpsert {
  index: number;
  eventKey: string;
  providerMessageId: string;
  remoteJid: string;
  fromMe: boolean;
  occurredAt: Date;
  identityStatus: 'verified' | 'derived' | 'unresolved' | 'conflict';
  canonicalPhone: string;
  item: Record<string, unknown>;
}

function parseReceipt(
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

  const remoteJid = readRemoteJid(data);
  return {
    instance,
    providerMessageId,
    fromMe: true,
    status: status as EvolutionReceiptStatus,
    ...(remoteJid ? { remoteJid } : {}),
  };
}

function parseUpsertItems(
  payload: Record<string, unknown>,
  configuredInstance: string,
  fallbackNow: Date,
): { parsed: ParsedUpsert[]; failureEventKey: string | null } | null {
  const instance = text(payload.instance);
  if (!configuredInstance || !instance || instance !== configuredInstance) return null;
  if (normalizedEventName(payload.event) !== 'messages.upsert') return null;

  const data = payload.data;
  const items = Array.isArray(data) ? data : record(data) ? [data] : [];
  if (!Array.isArray(data) && !record(data)) {
    return { parsed: [], failureEventKey: eventKey(instance, 0, '') };
  }
  const parsed: ParsedUpsert[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = record(items[index]);
    const providerMessageId = item ? readMessageId(item) : '';
    const key = eventKey(instance, index, providerMessageId);
    const remoteJid = item ? readRemoteJid(item) : '';

    // Group and broadcast messages are deliberately outside follow-up activity.
    if (remoteJid && isIgnoredRemoteJid(remoteJid)) continue;
    const fromMe = item ? readFromMe(item) : null;
    if (!item || !providerMessageId || !remoteJid || fromMe === null) {
      return { parsed: [], failureEventKey: key };
    }

    const identity = resolveWhatsappIdentity({
      chat: { ...item, remoteJid },
      messages: [item],
    });
    parsed.push({
      index,
      eventKey: key,
      providerMessageId,
      remoteJid,
      fromMe,
      occurredAt: parseMessageTimestamp(item.messageTimestamp, fallbackNow),
      identityStatus: identity.identityStatus,
      canonicalPhone: identity.canonicalPhone,
      item,
    });
  }
  return { parsed, failureEventKey: null };
}

/** Records the webhook durably; the caller answers with `response` and then runs `afterResponse`. */
export async function receiveEvolutionWebhook(
  event: FunctionEvent,
  dependencies: EvolutionWebhookDependencies = {},
): Promise<EvolutionWebhookOutcome> {
  if (String(event.httpMethod || '').toUpperCase() !== 'POST') {
    return { response: json(405, { error: 'Método não permitido.' }) };
  }

  const environment = dependencies.environment || process.env;
  if (!isMachineBearerAuthorized(event.headers, environment.EVOLUTION_WEBHOOK_SECRET)) {
    return { response: json(401, { error: 'Não autorizado.' }) };
  }

  const body = typeof event.body === 'string' ? event.body : '';
  if (Buffer.byteLength(body, 'utf8') > MAX_EVOLUTION_WEBHOOK_BODY_BYTES) {
    return { response: json(413, { error: 'Corpo da requisição excede o limite permitido.' }) };
  }

  const payload = parsePayload(body);
  if (!payload) return { response: json(400, { error: 'Corpo do webhook inválido.' }) };

  const configuredInstance = text(environment.EVOLUTION_INSTANCE);
  if (!configuredInstance) return { response: json(503, { error: 'Webhook da Evolution não configurado.' }) };

  const now = dependencies.now || (() => new Date());
  const upsert = parseUpsertItems(payload, configuredInstance, now());
  if (upsert) {
    const activityRepository =
      dependencies.activityRepository || createPostgresWhatsappContactActivityRepository();
    const followUpRepository: FollowUpConversationRepository =
      dependencies.followUpRepository ||
      (createPostgresQuotationFollowUpRepository() as unknown as FollowUpConversationRepository);
    if (upsert.failureEventKey) {
      await activityRepository.blockIngestion({
        instance: configuredInstance,
        eventKey: upsert.failureEventKey,
        now: now(),
      });
      return {
        response: json(503, {
          error: 'Não foi possível interpretar a mensagem recebida da Evolution. Tente novamente.',
        }),
      };
    }
    if (upsert.parsed.length === 0) return { response: json(200, { received: true }) };

    // Durable history first; the existing follow-up/activity effects still run
    // when it fails, but the provider only gets an acknowledgement after the
    // messages are stored (or already were).
    let historyStored = true;
    try {
      await ingestWhatsappUpserts({
        instance: configuredInstance,
        origin: 'live',
        items: upsert.parsed.map(
          (item): WhatsappUpsertIngestionItem => ({
            item: item.item,
            providerMessageId: item.providerMessageId,
            remoteJid: item.remoteJid,
            fromMe: item.fromMe,
            occurredAt: item.occurredAt,
          }),
        ),
        repository: dependencies.attendanceRepository,
      });
    } catch (error) {
      historyStored = false;
      console.error('[evolution-webhook] history', safeErrorSummary(error));
    }

    const effectInputs: FollowUpConversationInput[] = upsert.parsed.map((item) => ({
      instance: configuredInstance,
      providerConversationId: item.remoteJid,
      providerMessageId: item.providerMessageId,
      fromMe: item.fromMe,
      occurredAt: item.occurredAt,
      identityStatus: item.identityStatus,
      canonicalPhone: item.canonicalPhone || null,
    }));
    const runners = createWebhookEffectRunners(activityRepository, followUpRepository);
    const effectsRepository = dependencies.effectsRepository || createPostgresWhatsappWebhookEffectsRepository();
    let effectRecords: WebhookEffectRecord[] | null = null;
    try {
      effectRecords = await effectsRepository.register(effectInputs);
    } catch (error) {
      console.error('[evolution-webhook] effects', safeErrorSummary(error));
    }

    const markIngested = async () => {
      const latest = upsert.parsed.reduce((current, candidate) => {
        const currentTime = current.occurredAt.getTime();
        const candidateTime = candidate.occurredAt.getTime();
        return candidateTime > currentTime ||
          (candidateTime === currentTime &&
            candidate.providerMessageId > current.providerMessageId)
          ? candidate
          : current;
      });
      await activityRepository.markIngestion({
        instance: configuredInstance,
        eventKey: latest.eventKey,
        at: latest.occurredAt,
      });
      for (const item of upsert.parsed) {
        await activityRepository.unblockIngestionIfEvent({
          instance: configuredInstance,
          eventKey: item.eventKey,
        });
      }
    };
    const recordFailure = json(503, { error: RECORD_FAILURE });

    if (!effectRecords) {
      // Without a durable record the effects still run as before, but the
      // acknowledgement is withheld so the event can be retried.
      for (const input of effectInputs) {
        await runners.recordActivity(input);
        await runners.applyFollowUp(input);
      }
      await markIngested();
      return { response: recordFailure };
    }
    const records = effectRecords;
    return {
      response: historyStored ? json(200, { received: true }) : recordFailure,
      afterResponse: async () => {
        // Stop at the first failure: the remaining events stay pending in order
        // and resume on a provider retry or the next worker cycle.
        for (const record of records) {
          try {
            await applyWebhookEffects(record, runners, effectsRepository, now);
          } catch (error) {
            console.error('[evolution-webhook] effect', safeErrorSummary(error));
            return false;
          }
        }
        await markIngested();
        return true;
      },
    };
  }

  const evolutionEvent = parseReceipt(payload, configuredInstance);
  if (!evolutionEvent) return { response: json(200, { received: true, ignored: true }) };

  try {
    const deliveryModule = dependencies.deliveryModule || createQuotationDeliveryModule();
    // The receipt is stored in a durable inbox before correlation, so it is
    // acknowledged even when it arrives before `markAccepted` persisted the
    // provider id (or matches no step at all). Losing an acknowledgement is
    // therefore not a risk, and no provider replay is required.
    await deliveryModule.applyEvolutionEvent(evolutionEvent);
  } catch (error) {
    if (error instanceof QuotationDeliveryModuleInputError) {
      return { response: json(400, { error: error.message }) };
    }
    return {
      response: json(503, {
        error: 'Não foi possível processar o webhook da Evolution. Tente novamente.',
      }),
    };
  }
  return {
    response: json(200, { received: true }),
    // The receipt is already durable in the inbox; folding it into the
    // attendance message is best effort and recomputed on the next receipt or
    // on acceptance, so its failure never withholds the acknowledgement.
    afterResponse: async () => {
      try {
        const outbox = dependencies.outboxRepository || createPostgresWhatsappMessageOutboxRepository();
        await outbox.applyReceipts(evolutionEvent.providerMessageId);
      } catch (error) {
        console.error('[evolution-webhook] receipt', safeErrorSummary(error));
      }
      return true;
    },
  };
}
