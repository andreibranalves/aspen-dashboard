// POST /api/typebot-lead-capture
import type {
  FunctionEvent,
  FunctionResult,
  JsonResponseFn,
  LegacyHandler,
} from '../_lib/types.js';
//
// Validates a Bearer token, normalizes the inbound payload, and reproduces the
// current production diagnostic response while the route is disabled. When the
// route is enabled, it upserts an ERPNext Lead with email/phone dedup.

import { sendMetaLeadEvent } from './lib/meta-capi.js';
import { createHttpError, erpGetList, erpPost, erpPut } from './lib/erpnext.js';
import { upsertQuoteLead } from './lib/quote-leads-store.js';

const LIVE_DEPS = { erpGetList, erpPost, erpPut, upsertQuoteLead, sendMetaLeadEvent };

const jsonResponse: JsonResponseFn = (statusCode: number, body: unknown): FunctionResult => {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
};

function parseJsonBody(body: unknown): Record<string, unknown> {
  if (!body) return {};
  if (typeof body === 'object') return body as Record<string, unknown>;
  try {
    return JSON.parse(body as string);
  } catch {
    throw new Error('JSON inválido.');
  }
}

function normalizeText(value: unknown) {
  return String(value || '').trim();
}

function normalizeNullableText(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function normalizePhone(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function phoneVariants(phone: unknown): string[] {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];

  const variants = new Set([normalized]);
  const localDigits = normalized.startsWith('55') ? normalized.slice(2) : normalized;

  if (localDigits.length === 10 || localDigits.length === 11) {
    variants.add(localDigits);
    if (localDigits.length === 11) {
      variants.add(
        `(${localDigits.slice(0, 2)}) ${localDigits.slice(2, 7)}-${localDigits.slice(7)}`
      );
    }
    if (localDigits.length === 10) {
      variants.add(
        `(${localDigits.slice(0, 2)}) ${localDigits.slice(2, 6)}-${localDigits.slice(6)}`
      );
    }
  }

  return [...variants];
}

function normalizeSource(value: unknown) {
  const raw = normalizeText(value);
  if (raw === 'Meta Ads') return 'Meta Ads';
  return 'Website';
}

const ATTRIBUTION_FIELDS = [
  'page_url',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'source_cta',
  'result_id',
];

function normalizeLead(payload: Record<string, unknown>) {
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

function getBearerToken(headers: Record<string, string | undefined> = {}) {
  const raw = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1]?.trim() || '';
}

function isAuthorized(headers: Record<string, string | undefined> = {}) {
  const expected = String(process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN || '').trim();
  const received = getBearerToken(headers);
  return !!expected && received === expected;
}

function isEnabled() {
  return String(process.env.TYPEBOT_LEAD_CAPTURE_ENABLED || '').toLowerCase() === 'true';
}

function isDryRun(payload: Record<string, unknown>) {
  return payload.dry_run === true || payload.dryRun === true;
}

function isEmptyValue(value: unknown): boolean {
  return value == null || value === '';
}

function isBelowMinimumQuantity(quantity: unknown) {
  return normalizeText(quantity).toLowerCase().includes('menos de 30');
}

function buildQualificationNotes(
  lead: Record<string, unknown>
): Array<{ note: string }> | undefined {
  const lines = [
    lead.quantidade ? `Quantidade: ${lead.quantidade}` : '',
    lead.produto ? `Produto: ${lead.produto}` : '',
    lead.finalidade ? `Finalidade: ${lead.finalidade}` : '',
    lead.prazo ? `Prazo: ${lead.prazo}` : '',
    lead.arte ? `Arte: ${lead.arte}` : '',
    lead.mensagem_contexto ? `Contexto: ${lead.mensagem_contexto}` : '',
  ].filter(Boolean);
  if (lines.length === 0) return undefined;
  return [{ note: lines.join('\n') }];
}

function buildLeadDocPayload(
  lead: Record<string, unknown>,
  existing: Record<string, unknown> | null = null
) {
  const docPayload: Record<string, unknown> = { lead_name: lead.nome };
  if (lead.email) docPayload.email_id = lead.email;
  if (lead.telefone) docPayload.mobile_no = lead.telefone;
  if (lead.origem) docPayload.source = lead.origem;
  if (lead.empresa) docPayload.company_name = lead.empresa;

  const qualificationNotes = buildQualificationNotes(lead);
  if (qualificationNotes) docPayload.notes = qualificationNotes;

  for (const attr of ATTRIBUTION_FIELDS) {
    const incoming = lead[attr];
    if (isEmptyValue(incoming)) continue;
    const erpKey = `custom_${attr}`;
    if (existing && !isEmptyValue(existing[erpKey])) continue;
    docPayload[erpKey] = incoming;
  }

  return docPayload;
}

const ATTRIBUTION_ERP_FIELDS = ATTRIBUTION_FIELDS.map((attr) => `custom_${attr}`);

async function findExistingLead(lead: Record<string, unknown>, deps: typeof LIVE_DEPS) {
  const baseFields = ['name', 'email_id', 'mobile_no'];
  const fields = [...baseFields, ...ATTRIBUTION_ERP_FIELDS];

  if (lead.email) {
    const byEmail = await deps.erpGetList('Lead', {
      fields,
      filters: [['email_id', '=', lead.email as string]],
      order_by: 'modified desc',
      limit: 1,
    });
    if (byEmail.length > 0) return byEmail[0];
  }

  const variants = phoneVariants(lead.telefone);
  if (variants.length > 0) {
    const byPhone = await deps.erpGetList('Lead', {
      fields,
      or_filters: variants.map((value) => ['mobile_no', '=', value]),
      order_by: 'modified desc',
      limit: 1,
    });
    if (byPhone.length > 0) return byPhone[0];
  }

  return null;
}

function validateLeadForWrite(lead: Record<string, unknown>) {
  if (!lead.nome) {
    throw createHttpError(400, 'Nome é obrigatório.');
  }
}

async function simulateUpsert(lead: Record<string, unknown>, deps: typeof LIVE_DEPS) {
  validateLeadForWrite(lead);
  const existing = await findExistingLead(lead, deps);
  return {
    action: existing ? 'would_update' : 'would_create',
    leadId: existing?.name || null,
    existingLead: existing?.name || null,
  };
}

async function upsertLead(lead: Record<string, unknown>, deps: typeof LIVE_DEPS) {
  validateLeadForWrite(lead);

  const existing = await findExistingLead(lead, deps);
  const docPayload = buildLeadDocPayload(lead, existing);

  if (existing) {
    await deps.erpPut('Lead', existing.name, docPayload);
    return {
      action: 'updated',
      leadId: existing.name,
      existingLead: existing.name,
    };
  }

  const created = await deps.erpPost('Lead', docPayload);
  return {
    action: 'created',
    leadId: created.name || null,
    existingLead: null,
  };
}

export function createHandler(deps = LIVE_DEPS) {
  return async function typebotLeadCaptureHandler(event: FunctionEvent) {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: 'Method Not Allowed' });
    }

    if (!isAuthorized(event.headers as Record<string, string | undefined>)) {
      return jsonResponse(401, { error: 'Não autorizado.' });
    }

    let payload;
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
      });
    }

    try {
      const result = dryRun ? await simulateUpsert(lead, deps) : await upsertLead(lead, deps);

      let quoteLead = null;
      let quoteLeadError = null;

      if (!dryRun) {
        try {
          quoteLead = await deps.upsertQuoteLead({
            ...lead,
            source: 'typebot',
            sourceDetail: lead.canal || 'whatsapp',
            erpLeadId: result.leadId,
          });
        } catch (queueErr: any) {
          console.error(
            '[typebot-lead-capture] quote lead queue failed:',
            queueErr?.message || queueErr
          );
          quoteLeadError = 'Lead salvo no ERP, mas não entrou na fila de orçamento.';
        }
      }

      let metaResult = null;
      if (!dryRun) {
        const metaEventId = String(lead.result_id || result.leadId || `typebot-${Date.now()}`);
        metaResult = await deps.sendMetaLeadEvent({
          eventId: metaEventId,
          email: String(lead.email || ''),
          phone: String(lead.telefone || ''),
          eventSourceUrl: lead.page_url as string | null,
          quantity: lead.quantidade as string | null,
        });
      }

      return jsonResponse(200, {
        success: true,
        enabled,
        dry_run: dryRun,
        action: result.action,
        lead_id: result.leadId,
        lead,
        existing_lead: result.existingLead,
        activation_required: false,
        quote_lead: quoteLead ? { id: quoteLead.id, status: quoteLead.status } : null,
        ...(quoteLeadError ? { quote_lead_error: quoteLeadError } : {}),
        ...(metaResult ? { meta_capi: metaResult } : {}),
      });
    } catch (err: any) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[typebot-lead-capture]', err?.logMessage || err?.message || err);
      return jsonResponse(code, { error: err?.message || 'Erro interno.' });
    }
  };
}

export const handler: LegacyHandler = createHandler();
