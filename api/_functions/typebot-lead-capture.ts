// POST /api/typebot-lead-capture
import type {
  FunctionEvent,
  FunctionResult,
  JsonResponseFn,
  LegacyHandler,
} from '../_lib/types.js';
import { createHttpError } from '../_lib/http-error.js';
import {
  createPostgresQuoteLeadRepository,
  type QuoteLeadRecord,
  type QuoteLeadRepository,
} from '../_db/quote-leads-repository.js';
import { sendMetaLeadEvent } from './lib/meta-capi.js';

const LIVE_REPOSITORY = createPostgresQuoteLeadRepository();

interface LocalQuoteLeadResult {
  id: string;
  status: QuoteLeadRecord['status'];
  created?: boolean;
}

export interface TypebotLeadCaptureDeps {
  repository?: QuoteLeadRepository;
  upsertQuoteLead?: (input: Record<string, unknown>) => Promise<LocalQuoteLeadResult>;
  sendMetaLeadEvent?: typeof sendMetaLeadEvent;
}

const jsonResponse: JsonResponseFn = (statusCode: number, body: unknown): FunctionResult => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function parseJsonBody(body: unknown): Record<string, unknown> {
  if (!body) return {};
  if (typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(body));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not-object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw createHttpError(400, 'JSON inválido.');
  }
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeEmail(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizePhone(value: unknown): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function normalizeSource(value: unknown): string {
  return normalizeText(value) === 'Meta Ads' ? 'Meta Ads' : 'Website';
}

export function normalizeLead(payload: Record<string, unknown>) {
  return {
    nome: normalizeText(payload.nome),
    email: normalizeEmail(payload.email),
    telefone: normalizePhone(payload.telefone),
    origem: normalizeSource(payload.origem),
    canal: normalizeText(payload.canal) || 'whatsapp',
    produto: normalizeText(payload.produto),
    mensagem_contexto: normalizeText(payload.mensagem_contexto),
    empresa: normalizeText(payload.empresa),
    quantidade: normalizeText(payload.quantidade),
    finalidade: normalizeText(payload.finalidade),
    prazo: normalizeText(payload.prazo),
    arte: normalizeText(payload.arte),
    result_id: normalizeNullableText(payload.result_id),
    externalId: normalizeNullableText(
      payload.externalId || payload.external_id || payload.result_id
    ),
    page_url: normalizeNullableText(payload.page_url),
    utm_source: normalizeNullableText(payload.utm_source),
    utm_campaign: normalizeNullableText(payload.utm_campaign),
    utm_medium: normalizeNullableText(payload.utm_medium),
    utm_content: normalizeNullableText(payload.utm_content),
    utm_term: normalizeNullableText(payload.utm_term),
    campaign: normalizeNullableText(payload.campaign),
    gclid: normalizeNullableText(payload.gclid),
    gbraid: normalizeNullableText(payload.gbraid),
    wbraid: normalizeNullableText(payload.wbraid),
    fbclid: normalizeNullableText(payload.fbclid),
    source_cta: normalizeNullableText(payload.source_cta || payload.source),
  };
}

function getBearerToken(headers: Record<string, string | undefined> = {}): string {
  const raw = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1]?.trim() || '';
}

function isAuthorized(headers: Record<string, string | undefined> = {}): boolean {
  const expected = String(process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN || '').trim();
  return !!expected && getBearerToken(headers) === expected;
}

function isEnabled(): boolean {
  return String(process.env.TYPEBOT_LEAD_CAPTURE_ENABLED || '').toLowerCase() === 'true';
}

function isDryRun(payload: Record<string, unknown>): boolean {
  return payload.dry_run === true || payload.dryRun === true;
}

function isBelowMinimumQuantity(quantity: unknown): boolean {
  return normalizeText(quantity).toLowerCase().includes('menos de 30');
}

function validateLeadForWrite(lead: Record<string, unknown>): void {
  if (!lead.nome) throw createHttpError(400, 'Nome é obrigatório.');
}

function normalizeDeps(
  value: TypebotLeadCaptureDeps | QuoteLeadRepository
): TypebotLeadCaptureDeps {
  if (typeof (value as QuoteLeadRepository).upsert === 'function') {
    return { repository: value as QuoteLeadRepository };
  }
  return value as TypebotLeadCaptureDeps;
}

function localUpsert(
  deps: TypebotLeadCaptureDeps
): (input: Record<string, unknown>) => Promise<LocalQuoteLeadResult> {
  if (deps.upsertQuoteLead) return deps.upsertQuoteLead;
  if (deps.repository) return (input) => deps.repository!.upsert(input);
  return (input) => LIVE_REPOSITORY.upsert(input);
}

function localMetaSender(deps: TypebotLeadCaptureDeps): typeof sendMetaLeadEvent {
  return deps.sendMetaLeadEvent || sendMetaLeadEvent;
}

export function createHandler(
  input: TypebotLeadCaptureDeps | QuoteLeadRepository = {}
): LegacyHandler {
  const deps = normalizeDeps(input);
  const upsertQuoteLead = localUpsert(deps);
  const sendMeta = localMetaSender(deps);

  return async function typebotLeadCaptureHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: 'Método não permitido.' });
    }

    if (!isAuthorized(event.headers as Record<string, string | undefined>)) {
      return jsonResponse(401, { error: 'Não autorizado.' });
    }

    let payload: Record<string, unknown>;
    try {
      payload = parseJsonBody(event.body);
    } catch {
      return jsonResponse(400, { error: 'JSON inválido.' });
    }

    const enabled = isEnabled();
    const dryRun = isDryRun(payload);
    const lead = normalizeLead(payload);

    if (isBelowMinimumQuantity(lead.quantidade)) {
      return jsonResponse(400, { error: 'minimum_quantity_required' });
    }

    if (!enabled) {
      return jsonResponse(200, {
        success: true,
        enabled,
        dry_run: dryRun,
        action: 'would_create',
        lead_id: null,
        lead,
        existing_lead: null,
        activation_required: true,
        quote_lead: null,
      });
    }

    try {
      validateLeadForWrite(lead);
      if (dryRun) {
        return jsonResponse(200, {
          success: true,
          enabled,
          dry_run: true,
          action: 'would_create',
          lead_id: null,
          lead,
          existing_lead: null,
          activation_required: false,
          quote_lead: null,
        });
      }

      const quoteLead = await upsertQuoteLead({
        ...lead,
        source: 'typebot',
        sourceDetail: lead.canal || 'whatsapp',
      });
      const created = quoteLead.created !== false;
      const metaResult = await sendMeta({
        eventId: String(lead.result_id || quoteLead.id),
        email: String(lead.email || ''),
        phone: String(lead.telefone || ''),
        eventSourceUrl: lead.page_url,
        quantity: lead.quantidade,
      });

      return jsonResponse(200, {
        success: true,
        enabled,
        dry_run: false,
        action: created ? 'created' : 'updated',
        lead_id: quoteLead.id,
        lead,
        existing_lead: created ? null : quoteLead.id,
        activation_required: false,
        quote_lead: { id: quoteLead.id, status: quoteLead.status },
        meta_capi: metaResult,
      });
    } catch (err: unknown) {
      const details = err && typeof err === 'object' ? err as Record<string, unknown> : {};
      const code = Number.isInteger(details.statusCode) ? Number(details.statusCode) : 500;
      const message = typeof details.message === 'string' ? details.message : 'Erro interno.';
      console.error('[typebot-lead-capture]', details.logMessage || details.message || err);
      return jsonResponse(code, { error: message });
    }
  };
}

export const handler: LegacyHandler = createHandler();
