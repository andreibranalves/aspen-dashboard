import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import { createHash } from 'node:crypto';
import {
  createQuotationDocumentRepository,
  QuotationDocumentConflictError,
  QuotationDocumentNotFoundError,
  QuotationDocumentRepositoryError,
  type IssuedQuotationDocument,
  type QuotationDocumentRepository,
} from '../_db/quotation-document-repository.js';
import {
  quotationSnapshotViewModel,
} from '../_db/quotation-template-repository.js';
import {
  getQuotationTemplate,
  renderQuotationTemplate,
} from './lib/quotation-templates.js';
import { renderQuotationPdfHtml } from './lib/quotation-pdf.js';
import {
  createVercelQuotationDocumentStorage,
  isValidPdfBuffer,
  QUOTATION_PDF_MIME_TYPE,
  QuotationDocumentStorageError,
  quotationPdfPathname,
  type QuotationDocumentStorage,
} from './lib/quotation-document-storage.js';
import { isCoreQuotesEnabled, responseMetadata } from './orcamento-mode.js';

export class QuotationPdfRenderError extends Error {
  readonly statusCode = 502;
  readonly expose = false;

  constructor(message = 'Não foi possível gerar o PDF do orçamento. Tente novamente.') {
    super(message);
    this.name = 'QuotationPdfRenderError';
  }
}

export class QuotationIssueInputError extends Error {
  readonly statusCode = 400;
  readonly expose = true;

  constructor(message: string) {
    super(message);
    this.name = 'QuotationIssueInputError';
  }
}

export interface QuotationIssueDependencies {
  repository?: QuotationDocumentRepository;
  storage?: QuotationDocumentStorage;
  renderPdf?: (html: string) => Promise<Buffer>;
}

export interface QuotationIssueResult {
  document: IssuedQuotationDocument;
  alreadyIssued: boolean;
}

function json(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ ...payload, ...responseMetadata('core') }),
  };
}

function documentPayload(document: IssuedQuotationDocument): Record<string, unknown> {
  return {
    id: document.id,
    quotation_id: document.quotationId,
    revision_id: document.revisionId,
    kind: document.kind,
    storage_key: document.blobPathname,
    file_name: document.fileName,
    mime_type: document.mimeType,
    size_bytes: document.sizeBytes,
    checksum_sha256: document.checksumSha256,
    template_key: document.templateKey,
    template_hash: document.templateHash,
    issued_at: document.createdAt.toISOString(),
    download_url: `/api/quotation-document?id=${encodeURIComponent(document.id)}`,
  };
}

function parseBody(event: FunctionEvent): Record<string, unknown> {
  if (!event.body) return {};
  try {
    const parsed: unknown = JSON.parse(event.body);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The public error below deliberately does not expose parser details.
  }
  throw new QuotationIssueInputError('Envie um JSON válido para emitir o orçamento.');
}

function requestedId(event: FunctionEvent): string {
  const body = parseBody(event);
  const queryId = String(event.queryStringParameters?.id || '').trim();
  const bodyId = body.id === undefined ? '' : String(body.id).trim();
  if (queryId && bodyId && queryId !== bodyId) {
    throw new QuotationIssueInputError('Os identificadores do orçamento entram em conflito.');
  }
  const id = queryId || bodyId;
  if (!id) throw new QuotationIssueInputError('ID do orçamento não informado.');
  return id;
}

export async function issueQuotation(
  id: string,
  dependencies: QuotationIssueDependencies = {},
): Promise<QuotationIssueResult> {
  const repository = dependencies.repository || createQuotationDocumentRepository();
  const storage = dependencies.storage || createVercelQuotationDocumentStorage();
  const renderPdf = dependencies.renderPdf || renderQuotationPdfHtml;
  const source = await repository.prepare(id);
  if (!source) throw new QuotationDocumentNotFoundError('Orçamento não encontrado.');
  if (source.document) return { document: source.document, alreadyIssued: true };

  const { quotation, revision } = source.snapshot;
  if (quotation.status !== 'rascunho' || revision.status !== 'rascunho') {
    throw new QuotationDocumentConflictError('Somente revisões em rascunho podem ser emitidas.');
  }
  const template = getQuotationTemplate(revision.templatePadrao);
  if (!template || template.hash !== revision.templateHash) {
    throw new QuotationDocumentConflictError('O template original desta revisão não está disponível para emissão.');
  }

  const html = renderQuotationTemplate(template, quotationSnapshotViewModel(source.snapshot));
  const sourceHash = createHash('sha256').update(html, 'utf8').digest('hex');
  let pdf: Buffer;
  try {
    pdf = await renderPdf(html);
  } catch (error) {
    console.error(`[quotation-issue] render failed (${error instanceof Error ? error.name : typeof error})`);
    throw new QuotationPdfRenderError();
  }
  if (!Buffer.isBuffer(pdf) || !isValidPdfBuffer(pdf)) {
    throw new QuotationPdfRenderError('O gerador retornou um PDF inválido. Tente novamente.');
  }

  const pathname = quotationPdfPathname(quotation.businessNumber, revision.version, template.hash, sourceHash);
  const archived = await storage.archive(pathname, pdf);
  if (archived.pathname !== pathname || archived.sizeBytes < 1 || !/^[0-9a-f]{64}$/.test(archived.checksumSha256)) {
    throw new QuotationDocumentStorageError();
  }
  const document = await repository.complete({
    quotationId: quotation.id,
    revisionId: revision.id,
    expectedUpdatedAt: quotation.updatedAt.toISOString(),
    blobPathname: archived.pathname,
    fileName: `${quotation.businessNumber}-R${revision.version}.pdf`,
    mimeType: QUOTATION_PDF_MIME_TYPE,
    sizeBytes: archived.sizeBytes,
    checksumSha256: archived.checksumSha256,
    templateKey: template.key,
    templateHash: template.hash,
  });
  return { document, alreadyIssued: false };
}

function safeError(error: unknown): FunctionResult {
  if (
    error instanceof QuotationDocumentConflictError
    || error instanceof QuotationDocumentNotFoundError
    || error instanceof QuotationDocumentRepositoryError
    || error instanceof QuotationDocumentStorageError
    || error instanceof QuotationPdfRenderError
    || error instanceof QuotationIssueInputError
  ) {
    return json(error.statusCode, { error: error.message });
  }
  console.error(`[quotation-issue] failed (${error instanceof Error ? error.name : typeof error})`);
  return json(503, { error: 'Não foi possível emitir o orçamento. Tente novamente.' });
}

export function createQuotationIssueHandler(dependencies: QuotationIssueDependencies = {}): LegacyHandler {
  return async function quotationIssueHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (!isCoreQuotesEnabled()) return json(404, { error: 'Endpoint não encontrado.' });
    if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
    try {
      const result = await issueQuotation(requestedId(event), dependencies);
      return json(result.alreadyIssued ? 200 : 201, {
        status: 'emitido',
        already_issued: result.alreadyIssued,
        document: documentPayload(result.document),
      });
    } catch (error) {
      return safeError(error);
    }
  };
}

export const handler = createQuotationIssueHandler();
export const quotationIssueHandler = handler;
