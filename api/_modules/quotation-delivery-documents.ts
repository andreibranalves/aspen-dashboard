// PDF e imagens de uma revisão emitida, preparados pelo worker na hora do passo.

import { createQuotationTemplateRepository } from '../_infrastructure/db/repositories/quotation-template-repository.js';
import { canonicalQuotationStatus, isIssuedQuotationStatus } from './quotation-status.js';
import { renderQuotationDocument, type QuotationDocumentRenderer } from './quotation-document.js';
import { renderQuotationPdf, renderQuotationWebpHtml } from './quotation-pdf-renderer.js';
import {
  isValidPdfBuffer,
  isValidWebpBuffer,
  MAX_QUOTATION_PDF_BYTES,
  MAX_QUOTATION_WEBP_BYTES,
  quotationPdfChecksum,
  quotationWebpChecksum,
} from './quotation-document-storage.js';
import { safeErrorSummary } from '../_shared/safe-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// O worker classifica pelo nome e pelo `statusCode`: 404/409 e entrada inválida
// são permanentes para a revisão; o resto pode ser tentado de novo.
export class QuotationDeliveryInputError extends Error {
  readonly statusCode = 400;
  constructor(message: string) { super(message); this.name = 'QuotationDeliveryInputError'; }
}

export class QuotationDeliveryConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) { super(message); this.name = 'QuotationDeliveryConflictError'; }
}

export class QuotationDeliveryNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message = 'Revisão do orçamento não encontrada.') { super(message); this.name = 'QuotationDeliveryNotFoundError'; }
}

export class QuotationDeliveryRepositoryError extends Error {
  readonly statusCode = 503;
  // `cause` guarda o erro do banco para o log seguro (safeErrorSummary); nunca vai à resposta.
  constructor(message = 'Não foi possível preparar a entrega do orçamento. Tente novamente.', options?: ErrorOptions) { super(message, options); this.name = 'QuotationDeliveryRepositoryError'; }
}

export class QuotationDeliveryPdfError extends QuotationDeliveryRepositoryError {
  constructor(message = 'Não foi possível gerar o PDF da revisão. Tente novamente.') { super(message); this.name = 'QuotationDeliveryPdfError'; }
}

export class QuotationDeliveryImageError extends QuotationDeliveryRepositoryError {
  constructor(message = 'Não foi possível gerar a imagem da revisão. Tente novamente.') { super(message); this.name = 'QuotationDeliveryImageError'; }
}

export interface PreparedDeliveryDocument {
  pdf: Buffer;
  pdfSize: number;
  pdfSignature: string;
  validUntil: Date;
}

export interface PreparedDeliveryImage {
  webp: Buffer;
  webpSize: number;
  webpSignature: string;
  page: number;
  pageCount: number;
  validUntil: Date;
}

export interface QuotationDeliveryDocumentsOptions {
  now?: () => Date;
  repository?: ReturnType<typeof createQuotationTemplateRepository>;
  renderPdf?: (html: string) => Promise<Buffer>;
  renderImages?: (html: string) => Promise<Buffer[]>;
  renderDocument?: QuotationDocumentRenderer;
}

type Revision = NonNullable<Awaited<ReturnType<ReturnType<typeof createQuotationTemplateRepository>['get']>>>['revision'];

function asDate(value: Date | string | null | undefined, fallback: Date): Date {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? new Date(fallback) : new Date(date.getTime());
}

function revisionUuid(value: unknown): string {
  const result = String(value || '').trim();
  if (!UUID.test(result)) throw new QuotationDeliveryInputError('Identificador da revisão inválido.');
  return result;
}

function validUntil(revision: Revision): Date {
  const result = asDate(revision.issuedAt || revision.createdAt, new Date(0));
  result.setUTCDate(result.getUTCDate() + revision.validadeDias);
  return result;
}

function isKnownError(error: unknown): boolean {
  return error instanceof QuotationDeliveryInputError
    || error instanceof QuotationDeliveryConflictError
    || error instanceof QuotationDeliveryNotFoundError
    || error instanceof QuotationDeliveryRepositoryError;
}

export function createQuotationDeliveryDocuments(options: QuotationDeliveryDocumentsOptions = {}) {
  const now = options.now || (() => new Date());
  const repository = options.repository || createQuotationTemplateRepository();
  const renderPdf = options.renderPdf || renderQuotationPdf;
  const renderImages = options.renderImages || renderQuotationWebpHtml;
  const renderDocument = options.renderDocument || renderQuotationDocument;

  async function loadDeliveryQuotation(revisionIdInput: string): Promise<{ revision: Revision; html: string }> {
    const revisionId = revisionUuid(revisionIdInput);
    const current = asDate(now(), new Date());
    try {
      const snapshot = await repository.get(revisionId);
      if (!snapshot || snapshot.revision.id !== revisionId) {
        throw new QuotationDeliveryNotFoundError();
      }
      const { revision } = snapshot;
      let status: ReturnType<typeof canonicalQuotationStatus>;
      try { status = canonicalQuotationStatus(revision.status); }
      catch { throw new QuotationDeliveryConflictError('A revisão do orçamento possui estado inválido.'); }
      if (!isIssuedQuotationStatus(status)) throw new QuotationDeliveryConflictError('Somente revisões emitidas podem ser entregues.');
      if (current.getTime() >= validUntil(revision).getTime()) {
        throw new QuotationDeliveryConflictError('A revisão do orçamento está vencida. Emita uma nova revisão.');
      }
      if (
        revision.templateVersionId &&
        (!snapshot.templateVersion || snapshot.templateVersion.sourceHash !== revision.templateHash)
      ) {
        throw new QuotationDeliveryConflictError('O snapshot do template da revisão não está disponível.');
      }
      return { revision, html: renderDocument(snapshot).html };
    } catch (error) {
      if (isKnownError(error)) throw error;
      console.error(`[quotation-delivery] document failed (${safeErrorSummary(error)})`);
      throw new QuotationDeliveryRepositoryError(undefined, { cause: error });
    }
  }

  async function prepareDeliveryDocument(revisionId: string): Promise<PreparedDeliveryDocument> {
    const prepared = await loadDeliveryQuotation(revisionId);
    try {
      const pdf = await renderPdf(prepared.html);
      if (!Buffer.isBuffer(pdf) || pdf.length > MAX_QUOTATION_PDF_BYTES || !isValidPdfBuffer(pdf)) {
        throw new QuotationDeliveryPdfError('O PDF da revisão é inválido. Tente novamente.');
      }
      return {
        pdf,
        pdfSize: pdf.length,
        pdfSignature: quotationPdfChecksum(pdf),
        validUntil: validUntil(prepared.revision),
      };
    } catch (error) {
      if (error instanceof QuotationDeliveryPdfError) throw error;
      throw new QuotationDeliveryPdfError();
    }
  }

  async function prepareDeliveryImages(revisionId: string): Promise<PreparedDeliveryImage[]> {
    const prepared = await loadDeliveryQuotation(revisionId);
    try {
      const images = await renderImages(prepared.html);
      if (
        !Array.isArray(images) ||
        images.length === 0 ||
        images.length > 100 ||
        images.some(
          (image) =>
            !Buffer.isBuffer(image) ||
            image.length === 0 ||
            image.length > MAX_QUOTATION_WEBP_BYTES ||
            !isValidWebpBuffer(image),
        )
      ) {
        throw new QuotationDeliveryImageError('A imagem da revisão é inválida. Tente novamente.');
      }
      return images.map((webp, index) => ({
        webp,
        webpSize: webp.length,
        webpSignature: quotationWebpChecksum(webp),
        page: index + 1,
        pageCount: images.length,
        validUntil: validUntil(prepared.revision),
      }));
    } catch (error) {
      if (error instanceof QuotationDeliveryImageError) throw error;
      throw new QuotationDeliveryImageError();
    }
  }

  return { prepareDeliveryDocument, prepareDeliveryImages };
}
