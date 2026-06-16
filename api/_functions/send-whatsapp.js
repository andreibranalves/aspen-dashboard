// POST /api/send-whatsapp — sends quotation messages via Evolution API.
// Keeps commercial context in the app and uses Evolution API only as the WhatsApp transport.

import {
  erpGetList,
  erpGetDoc,
  erpPut,
  createHttpError,
  ERPNEXT_BASE,
  ERPNEXT_TOKEN,
} from './lib/erpnext.js';
import { generateQuotationPdf } from './lib/quotation-pdf.js';

const EVOLUTION_BASE_URL = (process.env.EVOLUTION_BASE_URL || '').replace(/\/+$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || '';
const DEFAULT_TEMPLATE =
  '(Saudacao), (primeiro_nome)! Tudo bem?\n\nSegue o orçamento (numero_pedido):\n(link_orcamento)\n\nQualquer dúvida estamos à disposição.\nAspen Estamparia';
const DEFAULT_SEQUENCE_STEPS = [
  { type: 'text', template: 'Olá, (primeiro_nome), tudo bem?' },
  {
    type: 'text',
    template:
      'Meu nome é (vendedora), da (empresa). Estou entrando em contato sobre o seu orçamento de (produto_resumo) (produto_adjetivo_personalizado).',
  },
  { type: 'text', template: 'Segue o orçamento (numero_pedido):\n(link_orcamento)' },
  {
    type: 'text',
    template:
      'Também estou te enviando algumas fotos de referência dos modelos para você visualizar melhor as opções.',
  },
  { type: 'product_images' },
];
const PRODUCT_CATEGORY_BY_PREFIX = {
  CNG: 'canga',
  LNC: 'lenço',
  BNE: 'boné',
  TWL: 'toalha',
  CHP: 'chapéu',
  ECO: 'ecobag',
  CHC: 'cachecol',
};
const PRODUCT_SUMMARY_PLURALS = {
  canga: 'cangas',
  lenço: 'lenços',
  boné: 'bonés',
  toalha: 'toalhas',
  chapéu: 'chapéus',
  ecobag: 'ecobags',
  cachecol: 'cachecóis',
};
const PRODUCT_CATEGORY_GENDERS = {
  canga: 'f',
  lenço: 'm',
  boné: 'm',
  toalha: 'f',
  chapéu: 'm',
  ecobag: 'f',
  cachecol: 'm',
};
const CATEGORY_ALIASES = {
  canga: 'canga',
  cangas: 'canga',
  lenco: 'lenço',
  lenço: 'lenço',
  lenços: 'lenço',
  bone: 'boné',
  boné: 'boné',
  bonés: 'boné',
  chapeu: 'chapéu',
  chapéu: 'chapéu',
  chapéus: 'chapéu',
  toalha: 'toalha',
  toalhas: 'toalha',
  ecobag: 'ecobag',
  ecobags: 'ecobag',
  cachecol: 'cachecol',
  cachecóis: 'cachecol',
  cachecois: 'cachecol',
};

// ── Basic helpers ───────────────────────────────────────────────────────────

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function normalizePhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  digits = digits.replace(/^55(\d{10,11})$/, '$1').replace(/^0(\d{10,11})$/, '$1');
  if (!/^\d{10,11}$/.test(digits)) return '';
  return `55${digits}`;
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function toPositiveInt(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function publicBaseUrl(event) {
  const host = event.headers?.host || 'project-xr5jg.vercel.app';
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(host);
  const protocol = isLocalHost
    ? 'http'
    : (event.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return `${protocol}://${host}`;
}

function absoluteUrl(url, baseUrl) {
  if (!url) return '';
  const value = String(url).trim();
  if (/^https?:\/\//i.test(value) || /^data:/i.test(value)) return value;
  if (value.startsWith('/')) return `${baseUrl}${value}`;
  return `${baseUrl}/${value}`;
}

function normalizeProductSummaryTemplate(template) {
  return String(template || DEFAULT_TEMPLATE)
    .replace(
      /\(produto_resumo\)\s+personalizado\(a\)/g,
      '(produto_resumo) (produto_adjetivo_personalizado)'
    )
    .replace(
      /\(produto_resumo\)\s+personalizados\(as\)/g,
      '(produto_resumo) (produto_adjetivo_personalizado)'
    );
}

function pluralizeProductCategory(category) {
  return PRODUCT_SUMMARY_PLURALS[category] || category;
}

function productPersonalizationAdjectiveFromCategories(categories = []) {
  const genders = categories.map((category) => PRODUCT_CATEGORY_GENDERS[category]).filter(Boolean);
  return genders.length > 0 && genders.every((gender) => gender === 'f')
    ? 'personalizadas'
    : 'personalizados';
}

function renderTemplate(template, context) {
  const h = new Date().getHours();
  const saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const nome = context.nome || '';
  const primeiroNome = nome.trim().split(/\s+/)[0] || nome;
  const productPersonalizationAdjective =
    context.productPersonalizationAdjective ||
    productPersonalizationAdjectiveFromCategories(context.categories);

  return normalizeProductSummaryTemplate(template)
    .replace(/\(Saudacao\)/g, saudacao)
    .replace(/\(nome\)/g, nome)
    .replace(/\(primeiro_nome\)/g, primeiroNome)
    .replace(/\(numero_pedido\)/g, context.quotationId || '')
    .replace(/\(empresa\)/g, 'Aspen Estamparia')
    .replace(/\(link_orcamento\)/g, context.link || '')
    .replace(/\(vendedora\)/g, context.vendorName || 'Juliana')
    .replace(/\(produto_resumo\)/g, context.productSummary || 'produtos')
    .replace(/\(produto_adjetivo_personalizado\)/g, productPersonalizationAdjective);
}

function parseContactFromRemarks(remarks = '') {
  const match = String(remarks).match(/Contato:\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)/i);
  if (!match) return {};
  return {
    nome: match[1]?.trim() || '',
    email: match[2]?.trim() || '',
    telefone: match[3]?.trim() || '',
  };
}

function normalizeCategory(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return CATEGORY_ALIASES[key] || value;
}

function detectCategories(items = []) {
  const categories = [];
  for (const item of items || []) {
    const sku = String(item?.sku || item?.item_code || item?.itemCode || '')
      .trim()
      .toUpperCase();
    const prefix = sku.split('-')[0];
    const category = PRODUCT_CATEGORY_BY_PREFIX[prefix];
    if (category && !categories.includes(category)) categories.push(category);
  }
  return categories;
}

function productSummaryFromCategories(categories = []) {
  const labels = categories.map(pluralizeProductCategory);
  if (!labels.length) return 'produtos';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} e ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}`;
}

function normalizeSampleImages(sampleImages = {}, baseUrl) {
  const normalized = {};
  for (const [rawCategory, rawUrls] of Object.entries(sampleImages || {})) {
    const category = normalizeCategory(rawCategory);
    const urls = Array.isArray(rawUrls) ? rawUrls : String(rawUrls || '').split(/\n|,/);
    normalized[category] = urls.map((url) => absoluteUrl(url, baseUrl)).filter(Boolean);
  }
  return normalized;
}

function buildSequenceSteps({ payload, sequence, context, baseUrl }) {
  const rawSteps =
    Array.isArray(sequence?.steps) && sequence.steps.length > 0
      ? sequence.steps
      : DEFAULT_SEQUENCE_STEPS;
  const maxImagesPerCategory = toPositiveInt(sequence?.max_images_per_category, 2, 0, 6);
  const categories = context.categories;
  const sampleImages = normalizeSampleImages(
    sequence?.sample_images || payload.sample_images || {},
    baseUrl
  );
  const planned = [];

  for (const rawStep of rawSteps.slice(0, 12)) {
    const type = String(rawStep?.type || 'text');
    if (type === 'product_images') {
      for (const category of categories) {
        const urls = (sampleImages[category] || []).slice(0, maxImagesPerCategory);
        for (let i = 0; i < urls.length; i++) {
          planned.push({
            type: 'image',
            media: urls[i],
            mimetype: rawStep.mimetype || 'image/jpeg',
            fileName: `${category}-${i + 1}.jpg`,
            caption: rawStep.caption ? renderTemplate(rawStep.caption, context) : '',
            category,
          });
        }
      }
      continue;
    }

    if (type === 'image') {
      const media = absoluteUrl(rawStep.media || rawStep.url, baseUrl);
      if (!media) continue;
      planned.push({
        type: 'image',
        media,
        mimetype: rawStep.mimetype || 'image/jpeg',
        fileName: rawStep.fileName || 'referencia.jpg',
        caption: rawStep.caption ? renderTemplate(rawStep.caption, context) : '',
      });
      continue;
    }

    if (type === 'document') {
      // quotation_pdf: send the actual PDF as a WhatsApp document attachment
      if (rawStep.source === 'quotation_pdf' && context.quotationId) {
        const caption = rawStep.caption ? renderTemplate(rawStep.caption, context).trim() : '';
        const fileName = `${context.quotationId}.pdf`;
        planned.push({
          type: 'document',
          media: `__pdf__:${context.quotationId}`,
          mimetype: rawStep.mimetype || 'application/pdf',
          fileName,
          caption,
        });
        continue;
      }

      // For external documents: convert URL to text message instead of sendMedia
      const media = absoluteUrl(rawStep.media || rawStep.url || context.pdfUrl, baseUrl);
      if (media) {
        const captionText = rawStep.caption ? `\n${renderTemplate(rawStep.caption, context)}` : '';
        planned.push({ type: 'text', text: `Documento: ${media}${captionText}` });
      }
      continue;
    }

    const text = renderTemplate(rawStep.template || rawStep.text || '', context).trim();
    if (text) planned.push({ type: 'text', text });
  }

  return planned;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs, maxMs) {
  if (maxMs <= minMs) return minMs;
  return Math.round(minMs + Math.random() * (maxMs - minMs));
}

// ── Quotation context resolution ────────────────────────────────────────────

async function resolveContactFromQuotation(quotationId) {
  if (!quotationId) return {};

  const quotation = await erpGetDoc('Quotation', quotationId).catch((err) => {
    throw createHttpError(
      err?.statusCode === 404 ? 404 : 502,
      'Orçamento não encontrado.',
      `[send-whatsapp] erpGetDoc(Quotation, ${quotationId}) failed: ${err?.logMessage || err?.message || err}`
    );
  });

  if (!quotation) {
    throw createHttpError(
      404,
      'Orçamento não encontrado.',
      `[send-whatsapp] null quotation ${quotationId}`
    );
  }

  const remarksContact = parseContactFromRemarks(quotation.remarks);
  let nome = firstNonEmpty(quotation.customer_name, remarksContact.nome, quotation.party_name);
  let email = firstNonEmpty(quotation.contact_email, remarksContact.email);
  let telefone = firstNonEmpty(
    quotation.contact_mobile,
    quotation.contact_phone,
    remarksContact.telefone
  );

  // Party fallback: Lead/Customer data.
  if ((!telefone || !email || !nome) && quotation.quotation_to && quotation.party_name) {
    try {
      const party = await erpGetDoc(quotation.quotation_to, quotation.party_name);
      telefone = firstNonEmpty(telefone, party?.mobile_no, party?.phone, party?.phone_no);
      email = firstNonEmpty(email, party?.email_id, party?.email);
      nome = firstNonEmpty(
        nome,
        party?.first_name,
        party?.lead_name,
        party?.customer_name,
        party?.name
      );
    } catch (err) {
      console.warn('[send-whatsapp] party lookup failed:', err?.logMessage || err?.message || err);
    }
  }

  // Contact fallback by contact_person or email.
  if ((!telefone || !email) && quotation.contact_person) {
    try {
      const contact = await erpGetDoc('Contact', quotation.contact_person);
      telefone = firstNonEmpty(
        telefone,
        contact?.mobile_no,
        contact?.phone,
        contact?.phone_nos?.find((p) => p.is_primary_mobile_no)?.phone,
        contact?.phone_nos?.[0]?.phone
      );
      email = firstNonEmpty(
        email,
        contact?.email_id,
        contact?.email_ids?.find((e) => e.is_primary)?.email_id,
        contact?.email_ids?.[0]?.email_id
      );
    } catch (err) {
      console.warn(
        '[send-whatsapp] contact_person lookup failed:',
        err?.logMessage || err?.message || err
      );
    }
  }

  // CRM Deal fallback — orcamento.js stores mobile_no and custom_quotation there.
  let dealId = null;
  try {
    const deals = await erpGetList('CRM Deal', {
      filters: [['custom_quotation', '=', quotationId]],
      fields: ['name', 'lead_name', 'email', 'mobile_no'],
      limit: 1,
    });
    if (deals.length > 0) {
      const deal = deals[0];
      dealId = deal.name;
      telefone = firstNonEmpty(telefone, deal.mobile_no);
      email = firstNonEmpty(email, deal.email);
      nome = firstNonEmpty(nome, deal.lead_name);
    }
  } catch (err) {
    console.warn('[send-whatsapp] deal lookup failed:', err?.logMessage || err?.message || err);
  }

  return {
    quotation,
    dealId,
    nome,
    email,
    telefone,
  };
}

// ── Evolution API ───────────────────────────────────────────────────────────

function assertEvolutionConfig() {
  const missing = [];
  if (!EVOLUTION_BASE_URL) missing.push('EVOLUTION_BASE_URL');
  if (!EVOLUTION_API_KEY) missing.push('EVOLUTION_API_KEY');
  if (!EVOLUTION_INSTANCE) missing.push('EVOLUTION_INSTANCE');
  if (missing.length > 0) {
    throw createHttpError(
      500,
      'Integração do WhatsApp não configurada. Verifique as variáveis da Evolution API.',
      `[send-whatsapp] missing env: ${missing.join(', ')}`
    );
  }
}

async function evolutionPost(path, body) {
  const url = `${EVOLUTION_BASE_URL}${path}`;
  let res;
  let responseBody;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: EVOLUTION_API_KEY,
      },
      body: JSON.stringify(body),
    });
    responseBody = await res.json().catch(() => null);
  } catch (err) {
    throw createHttpError(
      502,
      'Falha ao conectar com o WhatsApp. Tente novamente.',
      `[send-whatsapp] Evolution fetch failed: ${err.message}`
    );
  }

  if (!res.ok) {
    const detail =
      responseBody?.message ||
      responseBody?.error ||
      responseBody?.response?.message ||
      JSON.stringify(responseBody || {});
    throw createHttpError(
      res.status === 401 || res.status === 403 ? 502 : 400,
      'Não foi possível enviar a mensagem pelo WhatsApp. Verifique se a instância está conectada.',
      `[send-whatsapp] Evolution ${res.status}: ${detail}`
    );
  }

  return responseBody;
}

async function sendText(number, text) {
  return evolutionPost(`/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
    number,
    text,
  });
}

async function fetchQuotationPdfBuffer(quotationId) {
  try {
    const { buffer } = await generateQuotationPdf(quotationId, { timeout: 30000 });
    if (!buffer || buffer.length === 0) {
      throw createHttpError(
        502,
        'PDF do orçamento veio vazio.',
        `[send-whatsapp] empty PDF buffer for ${quotationId}`
      );
    }
    return buffer;
  } catch (err) {
    if (err?.statusCode) throw err;
    throw createHttpError(
      502,
      'Falha ao gerar o PDF do orçamento.',
      `[send-whatsapp] generateQuotationPdf error for ${quotationId}: ${err.message}`
    );
  }
}

async function sendMedia(number, step) {
  // ── Quotation PDF marker ──
  let media = step.media;
  if (media && typeof media === 'string' && media.startsWith('__pdf__:')) {
    const quotationId = media.slice('__pdf__:'.length);
    const buffer = await fetchQuotationPdfBuffer(quotationId);
    media = buffer.toString('base64');
  }

  // ── External media URL ──
  if (
    media &&
    ERPNEXT_TOKEN &&
    ERPNEXT_BASE &&
    typeof media === 'string' &&
    media.startsWith(ERPNEXT_BASE)
  ) {
    try {
      const res = await fetch(media, {
        headers: { Authorization: `token ${ERPNEXT_TOKEN}` },
      });
      if (!res.ok) {
        throw createHttpError(
          502,
          'Não foi possível baixar a mídia.',
          `[send-whatsapp] ERPNext media fetch failed: ${res.status} for ${media}`
        );
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      media = buffer.toString('base64');
    } catch (err) {
      if (err?.statusCode) throw err;
      throw createHttpError(
        502,
        'Falha ao processar a mídia para envio.',
        `[send-whatsapp] media download error: ${err.message}`
      );
    }
  }

  return evolutionPost(`/message/sendMedia/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
    number,
    mediatype: step.type === 'document' ? 'document' : 'image',
    mimetype: step.mimetype,
    caption: step.caption || '',
    media,
    fileName: step.fileName,
  });
}

async function sendStep(number, step) {
  if (step.type === 'text') return sendText(number, step.text);
  return sendMedia(number, step);
}

async function markDealAsSent(dealId, quotationId) {
  if (!dealId) return;
  try {
    await erpPut('CRM Deal', dealId, {
      status: 'Orcamento Enviado',
      custom_quotation: quotationId,
      custom_quotation_sent_date: new Date().toISOString().slice(0, 10),
      custom_follow_up_stage: 0,
    });
  } catch (err) {
    console.warn('[send-whatsapp] deal update failed:', err?.logMessage || err?.message || err);
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

async function dispatchN8n(payload, email) {
  const n8nUrl = process.env.N8N_WEBHOOK_URL;
  if (!n8nUrl) return;
  const timeoutSignal =
    typeof globalThis.AbortSignal?.timeout === 'function'
      ? globalThis.AbortSignal.timeout(5000)
      : undefined;
  const webhookPayload = {
    event: 'whatsapp_sent',
    quotation_id: payload.quotationId,
    deal_id: payload.dealId,
    nome: payload.nome,
    email: (email || '').trim(),
    telefone: payload.number,
  };
  fetch(n8nUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(webhookPayload),
    signal: timeoutSignal,
  }).catch((err) => console.error('[send-whatsapp] n8n webhook failed:', err.message));
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'JSON inválido' });
  }

  try {
    const dryRun = payload.dry_run === true || payload.dryRun === true;
    if (!dryRun) assertEvolutionConfig();

    const quotationId = String(payload.quotation_id || payload.quotationId || '').trim();
    const shouldResolveQuotation = quotationId && !dryRun;
    const resolved = shouldResolveQuotation ? await resolveContactFromQuotation(quotationId) : {};

    const nome = firstNonEmpty(payload.nome, resolved.nome);
    const rawPhone = firstNonEmpty(payload.telefone, payload.phone, resolved.telefone);
    const number = normalizePhone(rawPhone);
    if (!number) {
      throw createHttpError(400, 'Telefone inválido ou ausente para envio via WhatsApp.');
    }

    const baseUrl = publicBaseUrl(event);
    const link = firstNonEmpty(
      payload.link_orcamento,
      payload.short_url,
      quotationId ? `${baseUrl}/api/view?q=${encodeURIComponent(quotationId)}` : ''
    );

    const sequence = payload.whatsapp_sequence || payload.sequence || null;
    const items =
      payload.items ||
      payload.order_items ||
      payload.quotation_items ||
      resolved.quotation?.items ||
      [];
    const categories = detectCategories(items);
    const productSummary = firstNonEmpty(
      payload.produto_resumo,
      payload.product_summary,
      sequence?.product_summary,
      productSummaryFromCategories(categories)
    );
    const context = {
      nome,
      quotationId,
      link,
      vendorName: sequence?.vendor_name || payload.vendedora || payload.vendor_name || 'Juliana',
      productSummary,
      categories,
      pdfUrl: firstNonEmpty(payload.pdf_url, payload.pdfUrl, sequence?.pdf_url),
    };

    if (sequence) {
      const delayMinMs = toPositiveInt(
        sequence.delay_min_ms ?? sequence.delayMinMs,
        5000,
        0,
        30000
      );
      const delayMaxMs = toPositiveInt(
        sequence.delay_max_ms ?? sequence.delayMaxMs,
        Math.max(delayMinMs, 8000),
        delayMinMs,
        45000
      );
      const steps = buildSequenceSteps({ payload, sequence, context, baseUrl });
      if (steps.length === 0) {
        throw createHttpError(
          400,
          'Sequência de WhatsApp vazia. Configure ao menos uma mensagem ou mídia.'
        );
      }

      const evolution = [];
      if (!dryRun) {
        for (let i = 0; i < steps.length; i++) {
          if (i > 0) await wait(randomDelay(delayMinMs, delayMaxMs));
          const response = await sendStep(number, steps[i]);
          evolution.push(response);
        }
        await markDealAsSent(payload.deal_id || resolved.dealId, quotationId);
      }

      const dealId = payload.deal_id || resolved.dealId || null;
      if (!dryRun)
        dispatchN8n({ quotationId, dealId, nome, number }, resolved.email || payload.email);

      return jsonResponse(200, {
        success: true,
        dry_run: dryRun,
        quotation_id: quotationId || null,
        deal_id: payload.deal_id || resolved.dealId || null,
        number,
        delay_min_ms: delayMinMs,
        delay_max_ms: delayMaxMs,
        product_summary: productSummary,
        categories,
        steps,
        evolution,
      });
    }

    const text =
      firstNonEmpty(payload.mensagem, payload.message) || renderTemplate(payload.template, context);
    if (!text.trim()) {
      throw createHttpError(400, 'Mensagem vazia.');
    }

    const evolution = dryRun ? null : await sendText(number, text);
    if (!dryRun) {
      await markDealAsSent(payload.deal_id || resolved.dealId, quotationId);
      dispatchN8n(
        { quotationId, dealId: payload.deal_id || resolved.dealId || null, nome, number },
        resolved.email || payload.email
      );
    }

    return jsonResponse(200, {
      success: true,
      dry_run: dryRun,
      quotation_id: quotationId || null,
      deal_id: payload.deal_id || resolved.dealId || null,
      number,
      message: text,
      evolution,
    });
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[send-whatsapp]', err?.logMessage || err?.message || err);
    return jsonResponse(code, { error: err?.message || 'Erro interno.' });
  }
}
