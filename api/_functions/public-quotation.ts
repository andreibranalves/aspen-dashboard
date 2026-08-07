import { createHash, randomBytes } from 'node:crypto';
import { kv } from '@vercel/kv';
import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import { createQuotationTemplateRepository, quotationSnapshotViewModel } from '../_db/quotation-template-repository.js';
import {
  quotationTemplateFromVersion,
  renderQuotationTemplate,
  resolveQuotationTemplate,
} from './lib/quotation-templates.js';
import { renderQuotationPdfHtml } from './lib/quotation-pdf.js';
import { isValidPdfBuffer, quotationPdfChecksum } from './lib/quotation-document-storage.js';
import { isCoreReadEnabled } from './orcamento-mode.js';

const TOKEN_PREFIX = 'aspen:public-quotation:';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;

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

function ttl(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_TTL_SECONDS)
    : DEFAULT_TTL_SECONDS;
}

function renderSnapshot(snapshot: Awaited<ReturnType<NonNullable<PublicQuotationDependencies['repository']>['get']>>) {
  if (!snapshot) return null;
  const template = snapshot.templateVersion
    ? quotationTemplateFromVersion(snapshot.templateVersion)
    : resolveQuotationTemplate(snapshot.revision.templatePadrao, snapshot.revision.templateHash);
  const html = renderQuotationTemplate(template, quotationSnapshotViewModel(snapshot));
  return { snapshot, template, html };
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
    if (!isCoreReadEnabled()) return json(404, { error: 'Endpoint não encontrado.' });

    if (event.httpMethod === 'POST') {
      const input = parseBody(event.body);
      const identifier = String(input.revisionId || input.quotationId || '').trim();
      if (!identifier) return json(400, { error: 'Revisão do orçamento não informada.' });
      const snapshot = await repository.get(identifier);
      if (!snapshot) return json(404, { error: 'Orçamento não encontrado.' });
      if (snapshot.revision.status === 'rascunho') {
        return json(409, { error: 'Rascunhos não podem ser compartilhados.' });
      }
      const rawToken = makeToken();
      const expiresAt = now() + ttl(input.expiresInSeconds) * 1000;
      await store.set(
        key(rawToken),
        { quotationId: snapshot.quotation.id, revisionId: snapshot.revision.id, expiresAt },
        { ex: Math.ceil((expiresAt - now()) / 1000) }
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
      await store.set(key(token), { ...record, revokedAt: now() }, { ex: 24 * 60 * 60 });
      return json(204, {});
    }
    if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' });

    try {
      const snapshot = await repository.get(record.revisionId);
      if (!snapshot || snapshot.revision.id !== record.revisionId || snapshot.revision.status === 'rascunho') {
        return json(404, { error: 'Orçamento não encontrado.' });
      }
      const rendered = renderSnapshot(snapshot);
      if (!rendered) return json(404, { error: 'Orçamento não encontrado.' });
      if (event.queryStringParameters?.format === 'pdf') {
        const pdf = await renderPdf(rendered.html);
        if (!Buffer.isBuffer(pdf) || !isValidPdfBuffer(pdf)) {
          return json(503, { error: 'Não foi possível gerar o PDF do orçamento.' });
        }
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${snapshot.quotation.businessNumber}.pdf"`,
            'Cache-Control': 'private, no-store',
            'X-Document-Checksum': quotationPdfChecksum(pdf),
            'X-Document-Revision': snapshot.revision.id,
            'X-Quotation-Template-Version': String(snapshot.templateVersion?.version || 'legacy'),
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
          'X-Quotation-Template-Version': String(snapshot.templateVersion?.version || 'legacy'),
        },
        body: rendered.html,
      };
    } catch (error) {
      console.error(`[public-quotation] failed (${error instanceof Error ? error.name : typeof error})`);
      return json(503, { error: 'Não foi possível consultar o orçamento. Tente novamente.' });
    }
  };
}

export const handler = createPublicQuotationHandler();
