import { erpGetList, erpPost, erpPut, createHttpError } from './lib/erpnext.js';

const SAFE_LEAD_SOURCES = new Map([
  ['site', 'Website'],
  ['website', 'Website'],
  ['whatsapp', 'Website'],
  ['facebook', 'Facebook'],
  ['referencia', 'Reference'],
  ['reference', 'Reference'],
  ['indicacao', 'Reference'],
  ['campaign', 'Campaign'],
  ['campanha', 'Campaign'],
  ['advertisement', 'Advertisement'],
  ['anuncio', 'Advertisement'],
]);

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on', 'sim'].includes(value.trim().toLowerCase());
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeLeadEmail(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match ? match[0] : '';
}

function normalizeLeadPhone(value) {
  if (typeof value !== 'string') return '';
  let digits = value.replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 12 || digits.length > 13) return '';
  if (!digits.startsWith('55')) return '';
  return digits;
}

function maybeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function pickString(payload, keys) {
  const scopes = [
    maybeObject(payload),
    maybeObject(payload?.fields),
    maybeObject(payload?.variables),
    maybeObject(payload?.data),
  ];

  for (const scope of scopes) {
    for (const key of keys) {
      const value = scope[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }

  return '';
}

function inferProductFromContext(text) {
  const value = (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!value) return '';

  const catalog = [
    ['lencos', 'lenços'],
    ['lenco', 'lenços'],
    ['cangas', 'cangas'],
    ['canga', 'cangas'],
    ['toalhas', 'toalhas'],
    ['toalha', 'toalhas'],
    ['chapeus', 'chapéus'],
    ['chapeu', 'chapéus'],
    ['bones', 'bonés'],
    ['bone', 'bonés'],
    ['cachecois', 'cachecóis'],
    ['cachecol', 'cachecóis'],
    ['ecobags', 'ecobags'],
    ['ecobag', 'ecobags'],
    ['echarpes', 'echarpes'],
    ['echarpe', 'echarpes'],
  ];

  const hit = catalog.find(([keyword]) => value.includes(keyword));
  return hit ? hit[1] : '';
}

function mapLeadSource(origem, canal) {
  const raw = firstNonEmpty(origem, canal, 'Website')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  for (const [needle, mapped] of SAFE_LEAD_SOURCES) {
    if (raw.includes(needle)) return mapped;
  }

  return 'Website';
}

function extractLeadCapturePayload(payload) {
  const nome = firstNonEmpty(
    pickString(payload, ['nome', 'name', 'full_name', 'lead_name']),
  );
  const email = normalizeLeadEmail(
    pickString(payload, ['email', 'e-mail', 'mail'])
  );
  const telefone = normalizeLeadPhone(
    pickString(payload, ['telefone', 'phone', 'celular', 'whatsapp'])
  );
  const mensagemContexto = firstNonEmpty(
    pickString(payload, ['mensagem_contexto', 'context_message', 'initial_message', 'context', 'message'])
  );
  const origem = firstNonEmpty(
    pickString(payload, ['origem', 'source', 'lead_source']),
    'Website'
  );
  const canal = firstNonEmpty(
    pickString(payload, ['canal', 'channel']),
    'whatsapp'
  );
  const resultId = firstNonEmpty(
    pickString(payload, ['resultId', 'result_id'])
  );
  const pageUrl = firstNonEmpty(
    pickString(payload, ['page_url', 'pageUrl', 'url'])
  );
  const utmSource = firstNonEmpty(
    pickString(payload, ['utm_source', 'utmSource'])
  );
  const utmCampaign = firstNonEmpty(
    pickString(payload, ['utm_campaign', 'utmCampaign'])
  );

  return {
    nome,
    email,
    telefone,
    mensagemContexto,
    origem,
    canal,
    resultId,
    pageUrl,
    utmSource,
    utmCampaign,
    produto: inferProductFromContext(mensagemContexto),
  };
}

function getHeaders(event) {
  return maybeObject(event?.headers);
}

function assertWebhookAuth(event) {
  const expectedToken = (process.env.TYPEBOT_LEAD_WEBHOOK_TOKEN || '').trim();
  if (!expectedToken) {
    throw createHttpError(
      503,
      'Webhook Typebot não configurado.',
      '[typebot-lead-capture] TYPEBOT_LEAD_WEBHOOK_TOKEN ausente.'
    );
  }

  const headers = getHeaders(event);
  const authorization = firstNonEmpty(headers.authorization, headers.Authorization);
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
  const direct = firstNonEmpty(headers['x-typebot-token'], headers['X-Typebot-Token']);

  if (bearer !== expectedToken && direct !== expectedToken) {
    throw createHttpError(401, 'Não autorizado.', '[typebot-lead-capture] token inválido.');
  }
}

async function findExistingLead({ email, telefone }) {
  const orFilters = [];
  if (email) orFilters.push(['email_id', '=', email]);
  if (telefone) {
    orFilters.push(['mobile_no', '=', telefone]);
    if (telefone.startsWith('55')) orFilters.push(['mobile_no', '=', telefone.slice(2)]);
  }
  if (orFilters.length === 0) return null;

  const leads = await erpGetList('Lead', {
    fields: ['name', 'lead_name', 'email_id', 'mobile_no', 'source', 'creation'],
    or_filters: orFilters,
    order_by: 'creation desc',
    limit: 5,
  });

  return leads[0] || null;
}

function buildUpsertPlan(existingLead, payload) {
  const safeSource = mapLeadSource(payload.origem, payload.canal);

  if (!existingLead) {
    return {
      action: 'create',
      document: {
        lead_name: payload.nome,
        email_id: payload.email,
        mobile_no: payload.telefone,
        source: safeSource,
      },
    };
  }

  const updates = {};
  if (!existingLead.email_id && payload.email) updates.email_id = payload.email;
  if (!existingLead.mobile_no && payload.telefone) updates.mobile_no = payload.telefone;
  if (!existingLead.source && safeSource) updates.source = safeSource;

  return {
    action: Object.keys(updates).length > 0 ? 'update' : 'noop',
    existingLeadId: existingLead.name,
    document: updates,
  };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    assertWebhookAuth(event);

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      throw createHttpError(400, 'JSON inválido.');
    }

    const lead = extractLeadCapturePayload(payload);
    const dryRun = payload?.dry_run === true || payload?.dryRun === true;
    const enabled = parseBoolean(process.env.TYPEBOT_LEAD_CAPTURE_ENABLED);

    if (!lead.nome) throw createHttpError(400, 'Nome é obrigatório.');
    if (!lead.telefone) throw createHttpError(400, 'Telefone inválido ou ausente.');
    if (!lead.email) throw createHttpError(400, 'E-mail inválido ou ausente.');

    const shouldTouchErp = enabled && !dryRun;
    const existingLead = shouldTouchErp ? await findExistingLead(lead) : null;
    const plan = buildUpsertPlan(existingLead, lead);

    if (!enabled && !dryRun) {
      throw createHttpError(
        503,
        'Captura Typebot ainda não está ativa.',
        '[typebot-lead-capture] tentativa de escrita com feature flag desligada.'
      );
    }

    let persistedLeadId = existingLead?.name || null;
    if (shouldTouchErp) {
      if (plan.action === 'create') {
        const created = await erpPost('Lead', plan.document);
        persistedLeadId = created.name || null;
      } else if (plan.action === 'update') {
        await erpPut('Lead', plan.existingLeadId, plan.document);
        persistedLeadId = plan.existingLeadId;
      }
    }

    return json(200, {
      success: true,
      enabled,
      dry_run: dryRun,
      action: shouldTouchErp ? plan.action : `would_${plan.action}`,
      lead_id: persistedLeadId,
      lead: {
        nome: lead.nome,
        email: lead.email,
        telefone: lead.telefone,
        origem: mapLeadSource(lead.origem, lead.canal),
        canal: lead.canal,
        produto: lead.produto,
        mensagem_contexto: lead.mensagemContexto,
        result_id: lead.resultId || null,
        page_url: lead.pageUrl || null,
        utm_source: lead.utmSource || null,
        utm_campaign: lead.utmCampaign || null,
      },
      existing_lead: existingLead
        ? {
            id: existingLead.name,
            nome: existingLead.lead_name,
            email: existingLead.email_id || null,
            telefone: existingLead.mobile_no || null,
            origem: existingLead.source || null,
          }
        : null,
      activation_required: !enabled,
    });
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[typebot-lead-capture]', err?.logMessage || err?.message || err);
    return json(code, { error: err?.message || 'Erro interno.' });
  }
}

export {
  buildUpsertPlan,
  extractLeadCapturePayload,
  inferProductFromContext,
  mapLeadSource,
  normalizeLeadEmail,
  normalizeLeadPhone,
  parseBoolean,
};
