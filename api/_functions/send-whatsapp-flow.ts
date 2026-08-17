// POST /api/send-whatsapp-flow
//
// Executes a CommunicationFlow via Evolution API.
// Resolves product_media steps from the media library (Vercel Blob).
// Performs duplicate detection (30min window per quotation+phone+flow).
// Records send events in KV for history.
// Keeps send history in local KV and uses Evolution only as transport.
//
// Reuses Evolution delivery patterns from send-whatsapp.js.
// Storage: Vercel KV for flows, media, and send events.

import type { FunctionEvent, FunctionResult, JsonResponseFn } from '../_lib/types.js';
import type { HttpError } from '../_lib/http-error.js';
import { kv } from '@vercel/kv';
import { createHttpError } from '../_lib/http-error.js';
import { createQuotationTemplateRepository } from '../_db/quotation-template-repository.js';
import {
  createPostgresQuotationDeliveryRepository,
  QuotationDeliveryPdfError,
  type QuotationDeliveryRepository,
} from '../_db/quotation-delivery-repository.js';
import { loadPostgresSendContext } from './send-whatsapp.js';
import type { EvolutionDeliveryResult } from './lib/evolution-delivery.js';
import {
  canonicalFlowQuotationId,
  createDeliveryPlan,
  detectCategories,
  flowProductSummary,
  type DeliveryPlan,
  type DeliveryPlanInput,
} from './lib/quotation-delivery-plan.js';
import {
  EvolutionTransportError,
  sendFrozenStep,
  type EvolutionTransportDependencies,
} from './lib/evolution-transport.js';
import type { PreparedDeliveryDocument } from '../_db/quotation-delivery-repository.js';
import { KV_KEY_SEND_EVENTS_PREFIX } from '../_lib/media-schema.js';
import {
  canonicalWhatsappSendIdempotencyKey,
  defaultWhatsappSendReservationStore,
  WHATSAPP_SEND_RESOLUTION_CONFIRMATION,
  isWhatsappSendReservationStale,
  parseWhatsappSendReservationRecord,
  sanitizeWhatsappSendTerminalResult,
  type WhatsappSendAcceptedStepKind,
  type WhatsappSendReservationCasResult,
  type WhatsappSendReservationRecord,
  type WhatsappSendReservationStore,
  WhatsappSendReservationStorageError,
} from './lib/whatsapp-send-reservation-store.js';

const DUPLICATE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

// ── Helpers ─────────────────────────────────────────────────────────────────

const jsonResponse: JsonResponseFn = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function firstNonEmpty(...values: unknown[]): string {
  const found = values.find((v) => typeof v === 'string' && v.trim());
  return typeof found === 'string' ? found.trim() : '';
}

function minimalLocalIdentifier(value: string, label: string): string {
  if (!value || value.length > 255 || value.includes('://')) {
    throw createHttpError(400, `${label} inválido.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) throw createHttpError(400, `${label} inválido.`);
  }
  return value;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { canonicalFlowQuotationId, createDeliveryPlan, flowProductSummary };

// ── Duplicate detection ─────────────────────────────────────────────────────

async function checkDuplicate(quotationId: string, phone: string, flowId: string): Promise<boolean> {
  try {
    let keys = [];
    const result = await kv.scan(0, { match: `${KV_KEY_SEND_EVENTS_PREFIX}*`, count: 200 });
    keys = result[1] || [];

    const now = Date.now();
    for (const key of keys) {
      const event = await kv.get(key) as Record<string, unknown> | null;
      if (!event) continue;
      const eventTime = new Date((event.created_at || event.createdAt) as string).getTime();
      if (now - eventTime > DUPLICATE_WINDOW_MS) continue;
      if (event.quotation_id === quotationId && event.phone === phone && event.flow_id === flowId) {
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

// ── Send event recording ────────────────────────────────────────────────────

async function recordSendEvent({
  quotationId,
  phone,
  flowId,
  flowName,
  steps,
  evolution,
  duplicateWarning,
  errorMsg,
}: {
  quotationId: string;
  phone: string;
  flowId: string;
  flowName: string;
  steps: Array<Record<string, unknown>>;
  evolution: Array<Record<string, unknown>>;
  duplicateWarning: boolean;
  errorMsg?: string;
}) {
  const eventId = `send_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`;
  const event = {
    id: eventId,
    quotation_id: quotationId,
    phone,
    flow_id: flowId,
    flow_name: flowName,
    status: errorMsg ? 'failed' : 'sent',
    steps_planned: steps.length,
    steps_sent: evolution ? evolution.filter(Boolean).length : 0,
    duplicate_warning: !!duplicateWarning,
    error_message: errorMsg || '',
    sent_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
  try {
    await kv.set(`${KV_KEY_SEND_EVENTS_PREFIX}${eventId}`, event, { ex: 7 * 24 * 60 * 60 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[send-whatsapp-flow] KV send-event write failed:', msg);
  }
  return eventId;
}

function publicFrozenStep(step: DeliveryPlan['steps'][number]): Record<string, unknown> {
  if (step.type === 'text') return { type: 'text', text: step.payload.text };
  if (step.type === 'media') {
    const type = step.payload.mediaType === 'image' && /\.mp4$/i.test(step.payload.fileName)
      ? 'video'
      : step.payload.mediaType;
    return {
      type,
      media: step.payload.url,
      fileName: step.payload.fileName,
      caption: step.payload.caption,
    };
  }
  return {
    type: 'document',
    media: 'quotation_pdf',
    media_ref: 'quotation_pdf',
    generatedMedia: 'quotation_pdf',
    fileName: step.payload.fileName,
    caption: step.payload.caption,
  };
}

function frozenStepKind(step: DeliveryPlan['steps'][number]): WhatsappSendAcceptedStepKind {
  if (step.type === 'text') return 'text';
  if (step.type === 'quotation_pdf') return 'document';
  if (step.payload.mediaType === 'document') return 'document';
  return /\.mp4$/i.test(step.payload.fileName) ? 'video' : 'image';
}

// ── Handler ─────────────────────────────────────────────────────────────────

export type SendWhatsappFlowDependencies = {
  repository?: ReturnType<typeof createQuotationTemplateRepository>;
  store?: Parameters<typeof loadPostgresSendContext>[0]['store'];
  token?: () => string;
  headBlob?: DeliveryPlanInput['headBlob'];
  blobToken?: string;
  blobStoreId?: string;
  renderPdf?: Parameters<typeof loadPostgresSendContext>[0]['renderPdf'];
  mediaRecords?: Array<Record<string, unknown>>;
  readMediaRecords?: () => Promise<Array<Record<string, unknown>>>;
  resolveDeal?: Parameters<typeof loadPostgresSendContext>[0]['resolveDeal'];
  resolveMedia?: DeliveryPlanInput['resolveMedia'];
  resolveFlow?: DeliveryPlanInput['resolveFlow'];
  checkDuplicate?: typeof checkDuplicate;
  recordSendEvent?: typeof recordSendEvent;
  reservationStore?: WhatsappSendReservationStore;
  deliveryRepository?: Pick<QuotationDeliveryRepository, 'reserve' | 'recordState'> &
    Partial<Pick<QuotationDeliveryRepository, 'prepareDelivery' | 'prepareDeliveryDocument'>>;
  transport?: EvolutionTransportDependencies;
  beforeTransport?: (idempotencyKey: string) => Promise<void>;
};

function reservationPhase(record: WhatsappSendReservationRecord): string {
  return record.phase;
}

function stepKind(step: Record<string, unknown>): WhatsappSendAcceptedStepKind {
  if (step.type === 'text') return 'text';
  if (step.type === 'video') return 'video';
  if (step.type === 'document') return 'document';
  return 'image';
}

function neutralTerminalResult(result: Record<string, unknown>, steps: Record<string, unknown>[]): Record<string, unknown> {
  const neutral = { ...result };
  delete neutral.phone;
  return { ...neutral, steps: steps.map((step) => ({ type: stepKind(step) })) };
}

function reconciliationBody(phase = 'reconciling'): Record<string, unknown> {
  return {
    error: 'O envio permanece em reconciliação. Não reenvie automaticamente.',
    send_status: phase,
    reconciliation_required: true,
  };
}

function transportFailureResponse(error: EvolutionTransportError): {
  state: 'retryable' | 'reconciling';
  failureKind: EvolutionTransportError['kind'];
  statusCode: number;
  publicError: string;
  body: Record<string, unknown>;
} {
  if (error.kind === 'transient_pre_transport') {
    return {
      state: 'retryable',
      failureKind: error.kind,
      statusCode: 503,
      publicError: 'Falha transitória antes do transporte. Tente novamente.',
      body: { error: 'Falha transitória antes do transporte. Tente novamente.', send_status: 'retryable' },
    };
  }
  if (error.kind === 'permanent_pre_transport') {
    return {
      state: 'retryable',
      failureKind: error.kind,
      statusCode: 400,
      publicError: 'O envio foi rejeitado antes do transporte. Corrija os dados e tente novamente.',
      body: { error: 'O envio foi rejeitado antes do transporte. Corrija os dados e tente novamente.', send_status: 'retryable' },
    };
  }
  return {
    state: 'reconciling',
    failureKind: error.kind,
    statusCode: 503,
    publicError: 'O resultado do transporte requer reconciliação. Não reenvie automaticamente.',
    body: reconciliationBody(),
  };
}

function existingReservationResponse(
  record: WhatsappSendReservationRecord,
  flowId: string,
): FunctionResult | null {
  const existingPhase = reservationPhase(record);
  if (existingPhase === 'completed') {
    if (!record.result) throw new WhatsappSendReservationStorageError();
    return jsonResponse(200, sanitizeWhatsappSendTerminalResult(record.result, flowId));
  }
  if (existingPhase === 'accepted_partial') {
    return jsonResponse(503, {
      error: 'O transporte foi aceito e aguarda reconciliação. Não reenvie automaticamente.',
      send_status: 'accepted_partial',
      accepted_partial: true,
      provider_accepted: true,
      partial_send: true,
      reconciliation_required: true,
    });
  }
  if (existingPhase === 'transporting') return jsonResponse(409, reconciliationBody());
  if (existingPhase === 'reserved' && !isWhatsappSendReservationStale(record)) {
    return jsonResponse(409, {
      error: 'Já existe uma reserva para esta revisão e fluxo. Aguarde a reconciliação.',
      send_status: 'reserved',
      reconciliation_required: true,
    });
  }
  return null;
}

function validatedReservationRecord(
  value: unknown,
  key: string,
): WhatsappSendReservationRecord {
  return parseWhatsappSendReservationRecord(value, key);
}

function explicitCasResult(value: unknown, key: string): WhatsappSendReservationCasResult {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { ok?: unknown }).ok !== 'boolean') {
    return { ok: false, reason: 'invalid' };
  }
  const source = value as { ok: boolean; record?: unknown; reason?: unknown };
  if (source.ok) {
    try {
      return { ok: true, record: validatedReservationRecord(source.record, key) };
    } catch {
      return { ok: false, reason: 'invalid' };
    }
  }
  if (!['missing', 'conflict', 'invalid', 'storage'].includes(String(source.reason))) {
    return { ok: false, reason: 'invalid' };
  }
  if (source.record === undefined) return { ok: false, reason: source.reason as 'missing' | 'conflict' | 'invalid' | 'storage' };
  try {
    return {
      ok: false,
      reason: source.reason as 'missing' | 'conflict' | 'invalid' | 'storage',
      record: validatedReservationRecord(source.record, key),
    };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

async function casReservation(
  store: WhatsappSendReservationStore,
  input: Parameters<WhatsappSendReservationStore['compareAndSet']>[0],
): Promise<WhatsappSendReservationCasResult> {
  const candidate = store as WhatsappSendReservationStore & {
    compareAndSet?: WhatsappSendReservationStore['compareAndSet'];
    cas?: WhatsappSendReservationStore['cas'];
  };
  const raw = typeof candidate.compareAndSet === 'function'
    ? await candidate.compareAndSet(input)
    : typeof candidate.cas === 'function'
      ? await candidate.cas(input)
      : undefined;
  return explicitCasResult(raw, input.key);
}

async function casWithRetry(
  store: WhatsappSendReservationStore,
  input: Parameters<WhatsappSendReservationStore['compareAndSet']>[0],
): Promise<WhatsappSendReservationCasResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await casReservation(store, input);
      if (!result.ok && result.reason === 'storage') {
        if (attempt === 2) throw new WhatsappSendReservationStorageError();
        await wait(10 * (attempt + 1));
        continue;
      }
      return result;
    } catch (error) {
      if (attempt === 2) {
        if (error instanceof WhatsappSendReservationStorageError) throw error;
        throw new WhatsappSendReservationStorageError();
      }
      await wait(10 * (attempt + 1));
    }
  }
  throw new WhatsappSendReservationStorageError();
}

async function reservationConflictResponse(
  store: WhatsappSendReservationStore,
  key: string,
  flowId: string,
  conflict: WhatsappSendReservationCasResult,
): Promise<FunctionResult> {
  if (conflict.ok) {
    try {
      if (conflict.record.phase !== 'completed' || !conflict.record.result) return jsonResponse(503, reconciliationBody());
      return jsonResponse(200, sanitizeWhatsappSendTerminalResult(conflict.record.result, flowId));
    } catch {
      return jsonResponse(503, reconciliationBody());
    }
  }
  try {
    const current = await store.get(key);
    if (current) {
      const validated = parseWhatsappSendReservationRecord(current, key);
      if (validated.phase === 'completed' && validated.result) {
        return jsonResponse(200, sanitizeWhatsappSendTerminalResult(validated.result, flowId));
      }
    }
    return jsonResponse(conflict.reason === 'missing' ? 503 : 409, reconciliationBody());
  } catch {
    return jsonResponse(503, reconciliationBody());
  }
}

async function acceptedProviderCasFailure(
  store: WhatsappSendReservationStore,
  key: string,
  flowId: string,
  failure: WhatsappSendReservationCasResult,
): Promise<FunctionResult> {
  try {
    const current = await store.get(key);
    if (current) {
      const validated = parseWhatsappSendReservationRecord(current, key);
      if (validated.phase === 'completed' && validated.result) {
        return jsonResponse(200, sanitizeWhatsappSendTerminalResult(validated.result, flowId));
      }
    }
    if (!failure.ok && failure.reason === 'conflict') return jsonResponse(409, reconciliationBody());
  } catch {
    // Keep the neutral reconciliation response below when the state cannot be read.
  }
  return jsonResponse(503, {
    error: 'O transporte foi aceito, mas a reconciliação não pôde ser persistida. Não reenvie automaticamente.',
    send_status: 'reconciling',
    reconciliation_required: true,
  });
}

export async function handler(
  event: FunctionEvent,
  dependencies: SendWhatsappFlowDependencies = {},
): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Método não permitido.' });

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(event.body || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object');
    payload = parsed;
  } catch {
    return jsonResponse(400, { error: 'JSON inválido.' });
  }

  const flowResolver = dependencies.resolveFlow;
  const duplicateChecker = dependencies.checkDuplicate || checkDuplicate;
  const sendEventRecorder = dependencies.recordSendEvent || recordSendEvent;
  const reservationStore = dependencies.reservationStore || defaultWhatsappSendReservationStore;
  const deliveryRepository = dependencies.deliveryRepository
    || (Object.keys(dependencies).length === 0 ? createPostgresQuotationDeliveryRepository() : undefined);
  let reservation: WhatsappSendReservationRecord | null = null;
  let reservationKey!: string;

  try {
    const dryRun = payload.dry_run === true || payload.dryRun === true;
    const rawFlowId = firstNonEmpty(payload.flow_id, payload.flowId);
    const rawQuotationId = firstNonEmpty(
      payload.quotation_uuid,
      payload.quotationUuid,
      payload.quotation_id,
      payload.quotationId,
      payload.business_number,
      payload.businessNumber,
      payload.quote_id,
    );
    const rawRevisionId = firstNonEmpty(payload.revision_id, payload.revisionId, payload.quote_revision_id);
    if (!rawFlowId) throw createHttpError(400, 'ID do fluxo é obrigatório.');
    if (!rawQuotationId) throw createHttpError(400, 'Cotação PostgreSQL é obrigatória.');
    if (!rawRevisionId) throw createHttpError(400, 'Revisão PostgreSQL do orçamento é obrigatória.');
    const flowId = minimalLocalIdentifier(rawFlowId, 'ID do fluxo');
    const quotationId = minimalLocalIdentifier(rawQuotationId, 'Identificador do orçamento');
    const revisionId = minimalLocalIdentifier(rawRevisionId, 'Identificador da revisão');

    reservationKey = canonicalWhatsappSendIdempotencyKey(quotationId, revisionId, flowId);
    if (!dryRun) {
      let current: WhatsappSendReservationRecord | null;
      try {
        current = await reservationStore.get(reservationKey);
      } catch (error) {
        if (error instanceof WhatsappSendReservationStorageError) throw error;
        throw new WhatsappSendReservationStorageError();
      }
      if (current) {
        const validated = validatedReservationRecord(current, reservationKey);
        const replay = existingReservationResponse(validated, flowId);
        if (replay) return replay;
      }
    }

    const host = (event.headers?.host as string | undefined) || 'project-xr5jg.vercel.app';
    const proto = ((event.headers?.['x-forwarded-proto'] as string | undefined) || 'https').split(',')[0].trim();
    const baseUrl = `${proto}://${host}`;
    let context!: Awaited<ReturnType<typeof loadPostgresSendContext>>;
    let document: PreparedDeliveryDocument | undefined;
    const planInput: DeliveryPlanInput = {
      quotationId,
      businessNumber: firstNonEmpty(payload.business_number, payload.businessNumber),
      revisionId,
      flowId,
      baseUrl,
      needPdf: !dryRun && !deliveryRepository,
      resolveFlow: flowResolver,
      repository: dependencies.repository || createQuotationTemplateRepository(),
      store: dependencies.store,
      token: dependencies.token,
      renderPdf: dependencies.renderPdf,
      mediaRecords: dependencies.mediaRecords,
      readMediaRecords: dependencies.readMediaRecords,
      resolveDeal: dependencies.resolveDeal,
      resolveMedia: dependencies.resolveMedia
        ? (categories, maxItems, origin) => dependencies.resolveMedia!(categories, maxItems, origin)
        : undefined,
      headBlob: dependencies.headBlob,
      blobToken: dependencies.blobToken,
      blobStoreId: dependencies.blobStoreId,
      onContext: (resolved) => { context = resolved; },
    };
    const plan = await createDeliveryPlan(planInput);
    const steps = plan.steps;
    const businessNumber = plan.businessNumber;
    const items = context.view.items as Record<string, unknown>[];
    const categories = detectCategories(items);
    const productSummary = flowProductSummary(true, undefined, items);

    if (!dryRun && deliveryRepository) {
      try {
        if (deliveryRepository.prepareDeliveryDocument) {
          await deliveryRepository.reserve({ revisionId, phone: plan.phone, flowId });
          document = await deliveryRepository.prepareDeliveryDocument(revisionId);
        } else if (deliveryRepository.prepareDelivery) {
          document = await deliveryRepository.prepareDelivery({ revisionId, phone: plan.phone, flowId });
        } else {
          throw new Error('Preparação compatível indisponível.');
        }
      } catch (error) {
        if (error instanceof QuotationDeliveryPdfError) {
          const publicError = 'PDF indisponível. Tentar novamente.';
          try {
            await deliveryRepository.recordState({ revisionId, flowId, state: 'retryable', publicError });
            return jsonResponse(503, { error: publicError, send_status: 'retryable' });
          } catch {
            await deliveryRepository.recordState({
              revisionId,
              flowId,
              state: 'reconciling',
              publicError: 'A falha do PDF não pôde ser persistida. Reconciliação necessária.',
            }).catch(() => undefined);
            return jsonResponse(503, reconciliationBody());
          }
        }
        throw error;
      }
    } else if (!dryRun && context.pdfBase64) {
      const pdf = Buffer.from(context.pdfBase64, 'base64');
      if (pdf.length === 0) throw new QuotationDeliveryPdfError('O PDF da revisão é inválido. Tente novamente.');
      document = { pdf, pdfSize: pdf.length, pdfSignature: '', validUntil: new Date(0) };
    }
    const publicSteps = steps.map(publicFrozenStep);

    if (!dryRun) {
      let decision;
      try {
        decision = await reservationStore.reserve({
          key: reservationKey,
          quotationId,
          revisionId,
          flowId,
          stepsCount: steps.length,
        });
      } catch (error) {
        if (error instanceof WhatsappSendReservationStorageError) throw error;
        throw new WhatsappSendReservationStorageError();
      }
      const validated = validatedReservationRecord(decision.record, reservationKey);
      if (decision.kind === 'existing') {
        const replay = existingReservationResponse(validated, flowId);
        if (replay) return replay;
        if (validated.stepsCount !== steps.length) {
          throw new WhatsappSendReservationStorageError('O fluxo mudou enquanto o envio estava pendente.');
        }
        return jsonResponse(409, reconciliationBody());
      }
      if (validated.stepsCount !== steps.length) {
        throw new WhatsappSendReservationStorageError('A quantidade de etapas da reserva não corresponde ao fluxo.');
      }
      reservation = validated;
      await deliveryRepository?.recordState({ revisionId, flowId, state: 'pending' });
    }

    let duplicateWarning = false;
    if (businessNumber && !dryRun) duplicateWarning = await duplicateChecker(businessNumber, context.phone, flowId);

    const evolution: EvolutionDeliveryResult[] = [];
    if (!dryRun) {
      await dependencies.beforeTransport?.(reservationKey);
      for (let index = 0; index < steps.length; index += 1) {
        if (index > 0 && steps[index].delayMs > 0) await wait(steps[index].delayMs);
        if (!reservation) throw new WhatsappSendReservationStorageError();
        const transporting = await casWithRetry(reservationStore, {
          key: reservation.key,
          owner: reservation.owner,
          expectedVersion: reservation.version,
          from: reservationPhase(reservation) as 'reserved' | 'accepted_partial',
          to: 'transporting',
          currentStep: index,
        });
        if (!transporting.ok) {
          await deliveryRepository?.recordState({ revisionId, flowId, state: 'reconciling', publicError: 'A reserva de transporte mudou. Reconciliação necessária.' });
          return await reservationConflictResponse(reservationStore, reservation.key, flowId, transporting);
        }
        reservation = transporting.record;
        await deliveryRepository?.recordState({ revisionId, flowId, state: 'transporting' });
        const response = await sendFrozenStep(
          { phone: plan.phone, step: steps[index], document },
          dependencies.transport,
        );
        if (!response.accepted) {
          await deliveryRepository?.recordState({ revisionId, flowId, state: 'reconciling', publicError: 'A resposta do transporte não confirmou o resultado. Reconciliação necessária.' }).catch(() => undefined);
          return jsonResponse(503, reconciliationBody());
        }
        // Persist neutral acceptance before any next step or bookkeeping.
        const accepted = await casWithRetry(reservationStore, {
          key: reservation.key,
          owner: reservation.owner,
          expectedVersion: reservation.version,
          from: 'transporting',
          to: 'accepted_partial',
          currentStep: index,
          acceptedStep: { step: index, kind: frozenStepKind(steps[index]) },
          errorMessage: 'O transporte foi aceito e aguarda reconciliação.',
        });
        if (!accepted.ok) {
          await deliveryRepository?.recordState({ revisionId, flowId, state: 'reconciling', publicError: 'O transporte foi aceito. Reconciliação necessária.' });
          return await acceptedProviderCasFailure(reservationStore, reservation.key, flowId, accepted);
        }
        reservation = accepted.record;
        await deliveryRepository?.recordState({
          revisionId,
          flowId,
          state: 'accepted_partial',
          providerAcceptanceId: response.providerMessageId,
        });
        evolution.push(response);
      }
    }

    let sendEventId = null;
    if (!dryRun) {
      sendEventId = await sendEventRecorder({
        quotationId: businessNumber,
        phone: context.phone,
        flowId,
        flowName: plan.flowName,
        steps: publicSteps,
        evolution,
        duplicateWarning,
      });
    }
    const resultBody: Record<string, unknown> = {
      success: true,
      dry_run: dryRun,
      send_status: dryRun ? 'dry_run' : 'completed',
      duplicate_warning: duplicateWarning,
      duplicate_message: duplicateWarning ? 'Este fluxo já foi enviado para este telefone há menos de 30 minutos.' : '',
      flow_id: flowId,
      flow_name: plan.flowName,
      quotation_id: businessNumber || null,
      deal_id: context.dealId || null,
      phone: context.phone,
      product_summary: productSummary,
      categories,
      steps_count: steps.length,
      steps: publicSteps,
      send_event_id: sendEventId,
    };
    if (reservation) {
      const completed = await casWithRetry(reservationStore, {
        key: reservation.key,
        owner: reservation.owner,
        expectedVersion: reservation.version,
        from: 'accepted_partial',
        to: 'completed',
        result: neutralTerminalResult(resultBody, publicSteps),
      });
      if (!completed.ok) {
        await deliveryRepository?.recordState({ revisionId: reservation.revisionId, flowId, state: 'reconciling', publicError: 'A conclusão requer reconciliação.' });
        return await reservationConflictResponse(reservationStore, reservation.key, flowId, completed);
      }
      try {
        await deliveryRepository?.recordState({ revisionId: reservation.revisionId, flowId, state: 'completed' });
      } catch {
        await deliveryRepository?.recordState({ revisionId: reservation.revisionId, flowId, state: 'reconciling', publicError: 'A conclusão não pôde ser confirmada. Reconciliação necessária.' }).catch(() => undefined);
        return jsonResponse(503, reconciliationBody());
      }
    }
    return jsonResponse(200, resultBody);
  } catch (err: unknown) {
    const httpErr = err as HttpError;
    const code = Number.isInteger(httpErr?.statusCode) ? httpErr.statusCode : 500;
    console.error('[send-whatsapp-flow]', httpErr?.logMessage || httpErr?.message || err);
    if (err instanceof WhatsappSendReservationStorageError) {
      return jsonResponse(503, { error: 'Não foi possível consultar o estado durável do envio. Tente novamente sem repetir automaticamente.', send_status: 'reconciling', reconciliation_required: true });
    }
    const transportFailure = err instanceof EvolutionTransportError
      ? transportFailureResponse(err)
      : null;
    if (reservation) {
      const currentPhase = reservationPhase(reservation);
      if (
        transportFailure?.state === 'retryable'
        && currentPhase === 'transporting'
        && reservation.acceptedSteps.length === 0
      ) {
        try {
          await deliveryRepository?.recordState({
            revisionId: reservation.revisionId,
            flowId: reservation.flowId,
            state: transportFailure.state,
            failureKind: transportFailure.failureKind,
            publicError: transportFailure.publicError,
          });
        } catch {
          await deliveryRepository?.recordState({
            revisionId: reservation.revisionId,
            flowId: reservation.flowId,
            state: 'reconciling',
            failureKind: 'ambiguous',
            publicError: 'A falha não pôde ser persistida. Reconciliação necessária.',
          }).catch(() => undefined);
          return jsonResponse(503, reconciliationBody());
        }
        let transitioned: WhatsappSendReservationCasResult;
        try {
          transitioned = await reservationStore.resolve({
            key: reservation.key,
            expectedVersion: reservation.version,
            to: 'retryable',
            confirmation: WHATSAPP_SEND_RESOLUTION_CONFIRMATION,
          });
        } catch {
          await deliveryRepository?.recordState({
            revisionId: reservation.revisionId,
            flowId: reservation.flowId,
            state: 'reconciling',
            failureKind: 'ambiguous',
            publicError: 'A falha não pôde ser reconciliada. Reconciliação necessária.',
          }).catch(() => undefined);
          return jsonResponse(503, reconciliationBody());
        }
        if (!transitioned.ok) {
          await deliveryRepository?.recordState({
            revisionId: reservation.revisionId,
            flowId: reservation.flowId,
            state: 'reconciling',
            failureKind: 'ambiguous',
            publicError: 'A reserva não pôde ser atualizada. Reconciliação necessária.',
          }).catch(() => undefined);
          return await reservationConflictResponse(reservationStore, reservation.key, reservation.flowId, transitioned);
        }
        return jsonResponse(transportFailure.statusCode, transportFailure.body);
      }
      if (currentPhase === 'reserved') {
        try {
          const transitioned = await casWithRetry(reservationStore, {
            key: reservation.key,
            owner: reservation.owner,
            expectedVersion: reservation.version,
            from: 'reserved',
            to: 'retryable',
            errorMessage: 'Falha antes do transporte.',
          });
          if (!transitioned.ok) return await reservationConflictResponse(reservationStore, reservation.key, reservation.flowId, transitioned);
        } catch {
          return jsonResponse(503, { error: 'Não foi possível persistir a falha segura antes do transporte. Não repita automaticamente.', send_status: 'reconciling', reconciliation_required: true });
        }
        await deliveryRepository?.recordState({ revisionId: reservation.revisionId, flowId: reservation.flowId, state: 'retryable', publicError: 'Falha antes do transporte.' });
        return jsonResponse(code, { error: 'Falha antes do transporte. Tente novamente.', send_status: 'retryable' });
      }
      await deliveryRepository?.recordState({
        revisionId: reservation.revisionId,
        flowId: reservation.flowId,
        state: 'reconciling',
        failureKind: transportFailure?.failureKind,
        publicError: 'O envio permanece em reconciliação.',
      }).catch(() => undefined);
      return jsonResponse(503, {
        error: 'O envio permanece em reconciliação. Não reenvie automaticamente.',
        send_status: currentPhase === 'accepted_partial' ? 'accepted_partial' : 'reconciling',
        accepted_partial: currentPhase === 'accepted_partial',
        provider_accepted: currentPhase === 'accepted_partial',
        reconciliation_required: true,
      });
    }
    return jsonResponse(code, { error: httpErr?.message || 'Erro interno.' });
  }
}
