import { randomUUID } from 'node:crypto';

import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_http/types.js';
import { createPostgresQuoteLeadRepository } from '../_infrastructure/db/repositories/quote-leads-repository.js';
import { isMachineBearerAuthorized, MIN_MACHINE_SECRET_BYTES } from '../_shared/machine-auth.js';

const MAX_BODY_BYTES = 16_384;
const SANITY_ID_PATTERN =
  /^siteQuote\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ALLOWED_FIELDS = new Set([
  'externalId',
  'payloadFingerprint',
  'originalCreatedAt',
  'nome',
  'email',
  'whatsapp',
  'produto',
  'quantidade',
  'prazo',
  'mensagem',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'page_url',
  'consent',
]);

export interface SiteQuoteLeadInput extends Record<string, unknown> {
  source: 'site_form';
  externalId: string;
  payloadFingerprint: string;
  originalCreatedAt: string;
}

export interface SiteQuoteLeadsDependencies {
  ingest?: (input: SiteQuoteLeadInput) => Promise<{ result: 'created' | 'deduplicated' }>;
  environment?: { QUOTE_LEADS_INGEST_TOKEN?: string; QUOTE_LEADS_INGEST_PREVIOUS_TOKEN?: string };
  correlationId?: () => string;
}

function json(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function authorized(
  event: FunctionEvent,
  environment: SiteQuoteLeadsDependencies['environment']
): boolean {
  const currentToken = environment?.QUOTE_LEADS_INGEST_TOKEN?.trim() || '';
  if (Buffer.byteLength(currentToken, 'utf8') < MIN_MACHINE_SECRET_BYTES) return false;
  return (
    isMachineBearerAuthorized(event.headers, currentToken) ||
    isMachineBearerAuthorized(event.headers, environment?.QUOTE_LEADS_INGEST_PREVIOUS_TOKEN)
  );
}

function optionalText(body: Record<string, unknown>, key: string, max: number): string | null {
  const value = body[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('invalid_payload');
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error('invalid_payload');
  return normalized;
}

function parsePayload(raw: string): SiteQuoteLeadInput {
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw new Error('payload_too_large');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('invalid_json');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid_payload');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !ALLOWED_FIELDS.has(key))) throw new Error('invalid_payload');

  const externalId = optionalText(body, 'externalId', 255);
  const payloadFingerprint = optionalText(body, 'payloadFingerprint', 64);
  const originalCreatedAt = optionalText(body, 'originalCreatedAt', 40);
  const nome = optionalText(body, 'nome', 200);
  const email = optionalText(body, 'email', 254);
  const whatsapp = optionalText(body, 'whatsapp', 15);
  const produto = optionalText(body, 'produto', 255);
  const quantidade = optionalText(body, 'quantidade', 255);
  const mensagem = optionalText(body, 'mensagem', 4000);
  if (
    !externalId ||
    !SANITY_ID_PATTERN.test(externalId) ||
    !payloadFingerprint ||
    !SHA256_PATTERN.test(payloadFingerprint)
  ) {
    throw new Error('invalid_payload');
  }
  const originalDate = new Date(originalCreatedAt || '');
  if (
    !originalCreatedAt ||
    !Number.isFinite(originalDate.getTime()) ||
    originalDate.toISOString() !== originalCreatedAt
  ) {
    throw new Error('invalid_payload');
  }
  if (!nome || !email || !whatsapp || !/^\d{10,15}$/.test(whatsapp) || !produto || !quantidade) {
    throw new Error('invalid_payload');
  }
  const consent = body.consent;
  if (!consent || typeof consent !== 'object' || Array.isArray(consent))
    throw new Error('invalid_payload');
  const consentRecord = consent as Record<string, unknown>;
  if (
    Object.keys(consentRecord).some((key) => key !== 'given' && key !== 'source') ||
    consentRecord.given !== true ||
    consentRecord.source !== 'site_quote_form'
  ) {
    throw new Error('invalid_payload');
  }

  return {
    source: 'site_form',
    externalId,
    payloadFingerprint,
    originalCreatedAt,
    nome,
    email,
    whatsapp,
    produto,
    quantidade,
    mensagem,
    prazo: optionalText(body, 'prazo', 255),
    utm_source: optionalText(body, 'utm_source', 500),
    utm_medium: optionalText(body, 'utm_medium', 500),
    utm_campaign: optionalText(body, 'utm_campaign', 500),
    utm_content: optionalText(body, 'utm_content', 500),
    utm_term: optionalText(body, 'utm_term', 500),
    gclid: optionalText(body, 'gclid', 500),
    gbraid: optionalText(body, 'gbraid', 500),
    wbraid: optionalText(body, 'wbraid', 500),
    fbclid: optionalText(body, 'fbclid', 500),
    page_url: optionalText(body, 'page_url', 2048),
    consent: { given: true, source: 'site_quote_form' },
  };
}

export function createSiteQuoteLeadsHandler(
  dependencies: SiteQuoteLeadsDependencies = {}
): LegacyHandler {
  return async (event) => {
    if (String(event.httpMethod || '').toUpperCase() !== 'POST')
      return json(405, { error: 'Método não permitido.' });
    const environment = dependencies.environment || process.env;
    if (!authorized(event, environment)) return json(401, { error: 'Não autorizado.' });
    let input: SiteQuoteLeadInput;
    try {
      input = parsePayload(event.body || '');
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'payload_too_large')
        return json(413, { error: 'Corpo da requisição excede o limite permitido.' });
      return json(400, { error: 'Dados da solicitação inválidos.' });
    }
    try {
      const ingest =
        dependencies.ingest ||
        (async (payload: SiteQuoteLeadInput) => {
          const record = await createPostgresQuoteLeadRepository().ingestSiteSubmission(payload);
          return { result: record.created ? ('created' as const) : ('deduplicated' as const) };
        });
      const result = await ingest(input);
      return json(result.result === 'created' ? 201 : 200, {
        result: result.result,
        correlationId: (dependencies.correlationId || randomUUID)(),
      });
    } catch (error) {
      const statusCode =
        typeof error === 'object' && error !== null && 'statusCode' in error
          ? Number((error as { statusCode?: unknown }).statusCode)
          : 503;
      if (statusCode === 409)
        return json(409, { error: 'A chave da submissão já existe com conteúdo diferente.' });
      console.error('[site-quote-leads] ingest_failed');
      return json(503, { error: 'Não foi possível registrar a solicitação agora.' });
    }
  };
}

export const handler = createSiteQuoteLeadsHandler();
