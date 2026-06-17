// POST /api/typebot-lead-capture
//
// Validates a Bearer token, normalizes the inbound payload, and reproduces the
// current production diagnostic response while the route is disabled. When the
// route is enabled, it upserts an ERPNext Lead with email/phone dedup.

import { createHttpError, erpGetList, erpPost, erpPut } from './lib/erpnext.js';

const LIVE_DEPS = { erpGetList, erpPost, erpPut };

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseJsonBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('JSON inválido.');
  }
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function phoneVariants(phone) {
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

function normalizeSource() {
  return 'Website';
}

function normalizeLead(payload) {
  return {
    nome: normalizeText(payload.nome),
    email: normalizeEmail(payload.email),
    telefone: normalizePhone(payload.telefone),
    origem: normalizeSource(payload.origem),
    canal: normalizeText(payload.canal) || 'whatsapp',
    produto: normalizeText(payload.produto),
    mensagem_contexto: normalizeText(payload.mensagem_contexto),
    result_id: normalizeNullableText(payload.result_id),
    page_url: normalizeNullableText(payload.page_url),
    utm_source: normalizeNullableText(payload.utm_source),
    utm_campaign: normalizeNullableText(payload.utm_campaign),
  };
}

function getBearerToken(headers = {}) {
  const raw = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1]?.trim() || '';
}

function isAuthorized(headers = {}) {
  const expected = String(process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN || '').trim();
  const received = getBearerToken(headers);
  return !!expected && received === expected;
}

function isEnabled() {
  return String(process.env.TYPEBOT_LEAD_CAPTURE_ENABLED || '').toLowerCase() === 'true';
}

function isDryRun(payload) {
  return payload.dry_run === true || payload.dryRun === true;
}

function buildLeadDocPayload(lead) {
  const docPayload = { lead_name: lead.nome };
  if (lead.email) docPayload.email_id = lead.email;
  if (lead.telefone) docPayload.mobile_no = lead.telefone;
  if (lead.origem) docPayload.source = lead.origem;
  return docPayload;
}

async function findExistingLead(lead, deps) {
  if (lead.email) {
    const byEmail = await deps.erpGetList('Lead', {
      fields: ['name', 'email_id', 'mobile_no'],
      filters: [['email_id', '=', lead.email]],
      order_by: 'modified desc',
      limit: 1,
    });
    if (byEmail.length > 0) return byEmail[0];
  }

  const variants = phoneVariants(lead.telefone);
  if (variants.length > 0) {
    const byPhone = await deps.erpGetList('Lead', {
      fields: ['name', 'email_id', 'mobile_no'],
      or_filters: variants.map((value) => ['mobile_no', '=', value]),
      order_by: 'modified desc',
      limit: 1,
    });
    if (byPhone.length > 0) return byPhone[0];
  }

  return null;
}

function validateLeadForWrite(lead) {
  if (!lead.nome) {
    throw createHttpError(400, 'Nome é obrigatório.');
  }
}

async function simulateUpsert(lead, deps) {
  validateLeadForWrite(lead);
  const existing = await findExistingLead(lead, deps);
  return {
    action: existing ? 'would_update' : 'would_create',
    leadId: existing?.name || null,
    existingLead: existing?.name || null,
  };
}

async function upsertLead(lead, deps) {
  validateLeadForWrite(lead);

  const existing = await findExistingLead(lead, deps);
  const docPayload = buildLeadDocPayload(lead);

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

function createHandler(deps = LIVE_DEPS) {
  return async function typebotLeadCaptureHandler(event) {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { error: 'Method Not Allowed' });
    }

    if (!isAuthorized(event.headers)) {
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
      return jsonResponse(200, {
        success: true,
        enabled,
        dry_run: dryRun,
        action: result.action,
        lead_id: result.leadId,
        lead,
        existing_lead: result.existingLead,
        activation_required: false,
      });
    } catch (err) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[typebot-lead-capture]', err?.logMessage || err?.message || err);
      return jsonResponse(code, { error: err?.message || 'Erro interno.' });
    }
  };
}

export const handler = createHandler();
