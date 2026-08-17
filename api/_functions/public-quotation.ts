import { createHash, randomBytes } from 'node:crypto';
import { kv } from '@vercel/kv';
import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import { canonicalQuotationStatus, isIssuedQuotationStatus } from '../_lib/quotation-status.js';
import { createQuotationTemplateRepository, quotationSnapshotViewModel } from '../_db/quotation-template-repository.js';
import {
  quotationTemplateFromVersion,
  renderQuotationTemplate,
  resolveQuotationTemplate,
} from './lib/quotation-templates.js';
import { renderQuotationPdfHtml } from './lib/quotation-pdf-renderer.js';
import {
  isValidPdfBuffer,
  MAX_QUOTATION_PDF_BYTES,
  quotationPdfChecksum,
} from './lib/quotation-document-storage.js';
const TOKEN_PREFIX = 'aspen:public-quotation:';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
const REVOCATION_TTL_SECONDS = 24 * 60 * 60;
const UNAVAILABLE_MESSAGE = 'Não foi possível consultar o orçamento. Tente novamente.';

type TokenRecord = {
  quotationId: string;
  revisionId: string;
  expiresAt: number;
  revokedAt?: number;
};

type Kv = {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: { ex?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

export interface PublicQuotationDependencies {
  repository?: ReturnType<typeof createQuotationTemplateRepository>;
  store?: Kv;
  renderPdf?: (html: string) => Promise<Buffer>;
  now?: () => number;
  token?: () => string;
}

function json(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(payload),
  };
}

function unavailable(): FunctionResult {
  return json(503, { error: UNAVAILABLE_MESSAGE });
}

function logFailure(error: unknown): void {
  console.error(`[public-quotation] failed (${error instanceof Error ? error.name : typeof error})`);
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function key(token: string): string {
  return `${TOKEN_PREFIX}${tokenHash(token)}`;
}

function parseBody(body: string): Record<string, unknown> {
  try {
    const value = JSON.parse(body || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function safeToken(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(value) ? value : '';
}

/** Validate the only URL shape that may be sent to a customer. */
export function isRevisionBoundPublicQuotationUrl(
  value: unknown,
  applicationOrigin?: string,
): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  const raw = value.trim();
  try {
    const origin = applicationOrigin ? new URL(applicationOrigin).origin : '';
    const parsed = new URL(raw, origin || 'https://public-quotation.invalid');
    const relative = raw.startsWith('/') && !raw.startsWith('//');
    if (
      parsed.pathname !== '/api/public-quotation' ||
      !safeToken(parsed.searchParams.get('token'))
    ) return false;
    return relative || Boolean(origin && parsed.origin === origin);
  } catch {
    return false;
  }
}

function ttl(value: unknown, commercialSeconds?: number): number {
  const parsed = Number(value);
  const requested = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_SECONDS;
  const commercial = commercialSeconds === undefined ? MAX_TTL_SECONDS : Math.floor(commercialSeconds);
  if (!Number.isFinite(commercial) || commercial <= 0) throw new Error('Orçamento vencido não pode ser compartilhado.');
  return Math.min(requested, MAX_TTL_SECONDS, commercial);
}

function commercialTtlSeconds(
  snapshot: NonNullable<Awaited<ReturnType<NonNullable<PublicQuotationDependencies['repository']>['get']>>>,
  now: number,
): number {
  const issuedAt = snapshot.revision.issuedAt || snapshot.revision.createdAt;
  const issuedTime = issuedAt instanceof Date ? issuedAt.getTime() : new Date(String(issuedAt || '')).getTime();
  if (!Number.isFinite(issuedTime)) throw new Error('Validade comercial inválida.');
  return (issuedTime + Number(snapshot.revision.validadeDias) * 24 * 60 * 60 * 1000 - now) / 1000;
}

function assertShareableStatus(value: unknown): void {
  let status;
  try { status = canonicalQuotationStatus(value); } catch { throw new Error('Estado comercial inválido.'); }
  if (!isIssuedQuotationStatus(status)) throw new Error('Somente revisões emitidas podem ser compartilhadas.');
}

function renderSnapshot(
  snapshot: Awaited<ReturnType<NonNullable<PublicQuotationDependencies['repository']>['get']>>
) {
  if (!snapshot) return null;
  const template = snapshot.templateVersion
    ? quotationTemplateFromVersion(snapshot.templateVersion)
    : resolveQuotationTemplate(snapshot.revision.templatePadrao, snapshot.revision.templateHash);
  const html = renderQuotationTemplate(template, quotationSnapshotViewModel(snapshot));
  return { snapshot, template, html };
}

export async function issuePublicQuotationToken(
  input: {
    revisionId?: string;
    quotationId?: string;
    expiresInSeconds?: number;
    repository?: PublicQuotationDependencies['repository'];
    store?: Kv;
    now?: () => number;
    token?: () => string;
  } = {},
): Promise<{ token: string; expiresAt: number; revisionId: string; quotationId: string; businessNumber: string }> {
  const repository = input.repository || createQuotationTemplateRepository();
  const store = input.store || (kv as unknown as Kv);
  const identifier = String(input.revisionId || input.quotationId || '').trim();
  if (!identifier) throw new Error('Revisão do orçamento não informada.');
  const snapshot = await repository.get(identifier);
  if (!snapshot) throw new Error('Orçamento não encontrado.');
  assertShareableStatus(snapshot.revision.status);
  const now = input.now || (() => Date.now());
  const makeToken = input.token || (() => randomBytes(32).toString('base64url'));
  const rawToken = makeToken();
  const current = now();
  const expiresAt = current + ttl(input.expiresInSeconds, commercialTtlSeconds(snapshot, current)) * 1000;
  await store.set(
    key(rawToken),
    { quotationId: snapshot.quotation.id, revisionId: snapshot.revision.id, expiresAt },
    { ex: Math.ceil((expiresAt - current) / 1000) },
  );
  return {
    token: rawToken,
    expiresAt,
    revisionId: snapshot.revision.id,
    quotationId: snapshot.quotation.id,
    businessNumber: snapshot.quotation.businessNumber,
  };
}

export async function renderPublicQuotationPdf(
  revisionId: string,
  dependencies: Pick<PublicQuotationDependencies, 'repository' | 'renderPdf'> = {},
): Promise<Buffer> {
  const repository = dependencies.repository || createQuotationTemplateRepository();
  const snapshot = await repository.get(revisionId);
  const rendered = renderSnapshot(snapshot);
  if (!rendered || canonicalQuotationStatus(rendered.snapshot.revision.status) === 'rascunho') throw new Error('Orçamento não disponível para compartilhamento.');
  const renderPdf = dependencies.renderPdf || renderQuotationPdfHtml;
  const pdf = await renderPdf(rendered.html);
  if (!Buffer.isBuffer(pdf) || !isValidPdfBuffer(pdf)) throw new Error('Não foi possível gerar o PDF do orçamento.');
  return pdf;
}

export function createPublicQuotationHandler(
  dependencies: PublicQuotationDependencies = {}
): LegacyHandler {
  const repository = dependencies.repository || createQuotationTemplateRepository();
  const store = dependencies.store || (kv as unknown as Kv);
  const renderPdf = dependencies.renderPdf || renderQuotationPdfHtml;
  const now = dependencies.now || (() => Date.now());
  const makeToken = dependencies.token || (() => randomBytes(32).toString('base64url'));
  return async function publicQuotationHandler(event: FunctionEvent): Promise<FunctionResult> {
    try {
      if (event.httpMethod === 'POST') {
        const input = parseBody(event.body);
        const identifier = String(input.revisionId || input.quotationId || '').trim();
        if (!identifier) return json(400, { error: 'Revisão do orçamento não informada.' });
        const snapshot = await repository.get(identifier);
        if (!snapshot) return json(404, { error: 'Orçamento não encontrado.' });
        try { assertShareableStatus(snapshot.revision.status); }
        catch (error) { return json(409, { error: error instanceof Error ? error.message : 'Orçamento não pode ser compartilhado.' }); }
        const rawToken = makeToken();
        const current = now();
        let expiresAt: number;
        try { expiresAt = current + ttl(input.expiresInSeconds, commercialTtlSeconds(snapshot, current)) * 1000; }
        catch (error) { return json(409, { error: error instanceof Error ? error.message : 'Orçamento vencido.' }); }
        await store.set(
          key(rawToken),
          { quotationId: snapshot.quotation.id, revisionId: snapshot.revision.id, expiresAt },
          { ex: Math.ceil((expiresAt - current) / 1000) }
        );
        return json(201, {
          token: rawToken,
          expiresAt: new Date(expiresAt).toISOString(),
          revisionId: snapshot.revision.id,
          businessNumber: snapshot.quotation.businessNumber,
        });
      }

      const token = safeToken(event.queryStringParameters?.token);
      if (!token) return json(401, { error: 'Link público inválido.' });
      const record = await store.get<TokenRecord>(key(token));
      if (!record || record.revokedAt) return json(404, { error: 'Link público inválido.' });
      if (!Number.isFinite(record.expiresAt) || record.expiresAt <= now()) {
        return json(410, { error: 'Link público expirado.' });
      }

      if (event.httpMethod === 'DELETE') {
        await store.set(
          key(token),
          { ...record, revokedAt: now() },
          { ex: REVOCATION_TTL_SECONDS }
        );
        return json(204, {});
      }
      if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' });

      const snapshot = await repository.get(record.revisionId);
      if (!snapshot || snapshot.revision.id !== record.revisionId || canonicalQuotationStatus(snapshot.revision.status) === 'rascunho') {
        return json(404, { error: 'Orçamento não encontrado.' });
      }
      const rendered = renderSnapshot(snapshot);
      if (!rendered) return json(404, { error: 'Orçamento não encontrado.' });
      if (event.queryStringParameters?.format === 'pdf') {
        const pdf = await renderPdf(rendered.html);
        if (!Buffer.isBuffer(pdf) || !isValidPdfBuffer(pdf) || pdf.byteLength > MAX_QUOTATION_PDF_BYTES) {
          return json(503, { error: 'Não foi possível gerar o PDF do orçamento.' });
        }
        const templateVersion = rendered.snapshot.templateVersion
          ? String(rendered.snapshot.templateVersion.version)
          : 'builtin';
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${snapshot.quotation.businessNumber}.pdf"`,
            'Content-Length': String(pdf.byteLength),
            'Cache-Control': 'private, no-store',
            'X-Document-Checksum': quotationPdfChecksum(pdf),
            'X-Document-Size': String(pdf.byteLength),
            'X-Document-Revision': snapshot.revision.id,
            'X-Quotation-Template-Key': rendered.template.key,
            'X-Quotation-Template-Version': templateVersion,
            'X-Quotation-Template-Hash': rendered.template.hash,
          },
          body: pdf.toString('base64'),
          isBase64Encoded: true,
        };
      }
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'private, no-store',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:; script-src 'none'; frame-ancestors 'none'",
          'X-Document-Revision': snapshot.revision.id,
          'X-Quotation-Template-Key': rendered.template.key,
          'X-Quotation-Template-Version': rendered.snapshot.templateVersion
            ? String(rendered.snapshot.templateVersion.version)
            : 'builtin',
          'X-Quotation-Template-Hash': rendered.template.hash,
        },
        body: rendered.html,
      };
    } catch (error) {
      logFailure(error);
      return unavailable();
    }
  };
}

export const handler = createPublicQuotationHandler();
