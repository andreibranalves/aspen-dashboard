import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import {
  createQuotationDocumentRepository,
  QuotationDocumentRepositoryError,
  type QuotationDocumentRepository,
} from '../_db/quotation-document-repository.js';
import {
  createVercelQuotationDocumentStorage,
  QUOTATION_PDF_MIME_TYPE,
  QuotationDocumentStorageError,
  type QuotationDocumentStorage,
} from './lib/quotation-document-storage.js';
import { isCoreQuotesEnabled } from './orcamento-mode.js';

export interface QuotationDocumentHandlerDependencies {
  repository?: QuotationDocumentRepository;
  storage?: QuotationDocumentStorage;
}

function json(statusCode: number, error: string): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ error }),
  };
}

export function createQuotationDocumentHandler(
  dependencies: QuotationDocumentHandlerDependencies = {},
): LegacyHandler {
  const repository = dependencies.repository || createQuotationDocumentRepository();
  const storage = dependencies.storage || createVercelQuotationDocumentStorage();
  return async function quotationDocumentHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (!isCoreQuotesEnabled()) return json(404, 'Endpoint não encontrado.');
    if (event.httpMethod !== 'GET') return json(405, 'Método não permitido.');
    const id = String(event.queryStringParameters?.id || '').trim();
    if (!id) return json(400, 'ID do documento não informado.');

    try {
      const document = await repository.find(id);
      if (!document) return json(404, 'Documento emitido não encontrado.');
      const stored = await storage.read(document.blobPathname);
      if (!stored) return json(503, 'O arquivo do documento emitido está indisponível. Tente novamente.');
      if (
        stored.pathname !== document.blobPathname
        || stored.contentType !== QUOTATION_PDF_MIME_TYPE
        || stored.sizeBytes !== document.sizeBytes
        || stored.checksumSha256 !== document.checksumSha256
      ) {
        console.error(`[quotation-document] integrity mismatch (${document.id})`);
        return json(503, 'A integridade do PDF emitido não pôde ser confirmada.');
      }
      return {
        statusCode: 200,
        headers: {
          'Content-Type': QUOTATION_PDF_MIME_TYPE,
          'Content-Disposition': `inline; filename="${document.fileName}"`,
          'Content-Length': String(stored.sizeBytes),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Quotation-Document-Checksum': document.checksumSha256,
        },
        body: stored.buffer.toString('base64'),
        isBase64Encoded: true,
      };
    } catch (error) {
      if (error instanceof QuotationDocumentRepositoryError || error instanceof QuotationDocumentStorageError) {
        return json(error.statusCode, error.message);
      }
      console.error(`[quotation-document] failed (${error instanceof Error ? error.name : typeof error})`);
      return json(503, 'Não foi possível baixar o PDF emitido. Tente novamente.');
    }
  };
}

export const handler = createQuotationDocumentHandler();
export const quotationDocumentHandler = handler;
