import { randomUUID } from 'node:crypto';

import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_http/types.js';
import { createPostgresQuoteLeadRepository } from '../_infrastructure/db/repositories/quote-leads-repository.js';
import { isMachineBearerAuthorized, MIN_MACHINE_SECRET_BYTES } from '../_shared/machine-auth.js';

const MAX_BODY_BYTES = 16_384;
const SANITY_ID_PATTERN =
  /^siteQuote\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const AD_CONSENT_POLICY_VERSION = '2026-08-18';
const AD_CONSENT_SOURCE = 'site_cookie_preferences';
const CLICK_ID_MAX_LENGTH = 500;
const EVIDENCE_ID_PATTERN = /^[\w-]{1,128}$/;
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

// Click identifiers are opaque Google values: preserved verbatim with no trim,
// normalization or truncation. Absent/empty is valid; oversized is rejected.
function verbatimClickId(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > CLICK_ID_MAX_LENGTH)
    throw new Error('invalid_payload');
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalRfc3339(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 24 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    new Date(value).toISOString() === value
  );
}

/**
 * Strict ad-consent contract per issue #208. The payload is either the generic
 * `{given:true, source:'site_quote_form'}` (insufficient for ads export) or the
 * full evidence grant; anything else — old policy versions, malformed shapes,
 * mixed fields — is rejected and never silently demoted to generic consent.
 */
function parseConsent(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error('invalid_payload');
  const keys = Object.keys(value);
  if (
    keys.length === 2 &&
    value.given === true &&
    value.source === 'site_quote_form'
  ) {
    return { given: true, source: 'site_quote_form' };
  }
  const evidenceKeys = new Set([
    'adUserData',
    'adPersonalization',
    'policyVersion',
    'reviewedAt',
    'source',
    'evidenceId',
  ]);
  if (
    keys.some((key) => !evidenceKeys.has(key)) ||
    value.adUserData !== 'CONSENT_GRANTED' ||
    value.adPersonalization !== 'CONSENT_GRANTED' ||
    value.policyVersion !== AD_CONSENT_POLICY_VERSION ||
    !canonicalRfc3339(value.reviewedAt) ||
    value.source !== AD_CONSENT_SOURCE
  ) {
    throw new Error('invalid_payload');
  }
  const evidenceId = value.evidenceId;
  if (
    evidenceId !== undefined &&
    (typeof evidenceId !== 'string' || !EVIDENCE_ID_PATTERN.test(evidenceId))
  ) {
    throw new Error('invalid_payload');
  }
  return {
    adUserData: 'CONSENT_GRANTED',
    adPersonalization: 'CONSENT_GRANTED',
    policyVersion: AD_CONSENT_POLICY_VERSION,
    reviewedAt: value.reviewedAt,
    source: AD_CONSENT_SOURCE,
    ...(evidenceId !== undefined ? { evidenceId } : {}),
  };
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
  const consent = parseConsent(body.consent);

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
    gclid: verbatimClickId(body, 'gclid'),
    gbraid: verbatimClickId(body, 'gbraid'),
    wbraid: verbatimClickId(body, 'wbraid'),
    fbclid: optionalText(body, 'fbclid', 500),
    page_url: optionalText(body, 'page_url', 2048),
    consent,
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
