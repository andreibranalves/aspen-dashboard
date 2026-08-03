import { get, put } from '@vercel/blob';
import { createHash } from 'node:crypto';

export const QUOTATION_PDF_MIME_TYPE = 'application/pdf' as const;

export interface ArchivedQuotationPdf {
  pathname: string;
  sizeBytes: number;
  checksumSha256: string;
}

export interface StoredQuotationPdf extends ArchivedQuotationPdf {
  buffer: Buffer;
  contentType: string;
}

export interface QuotationDocumentStorage {
  archive(pathname: string, buffer: Buffer): Promise<ArchivedQuotationPdf>;
  read(pathname: string): Promise<StoredQuotationPdf | null>;
}

export interface QuotationBlobClient {
  put: typeof put;
  get: typeof get;
}

export class QuotationDocumentStorageError extends Error {
  readonly statusCode = 503;
  readonly expose = false;

  constructor(message = 'Não foi possível arquivar o PDF do orçamento. Tente novamente.') {
    super(message);
    this.name = 'QuotationDocumentStorageError';
  }
}

export function quotationPdfChecksum(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function isValidPdfBuffer(buffer: Buffer): boolean {
  return buffer.length > 8
    && buffer.subarray(0, 5).toString('ascii') === '%PDF-'
    && buffer.subarray(Math.max(0, buffer.length - 2048)).includes(Buffer.from('%%EOF'));
}

function quotationBlobAuth(): { token?: string; storeId?: string } {
  const token = process.env.QUOTATION_BLOB_READ_WRITE_TOKEN?.trim();
  const storeId = process.env.QUOTATION_BLOB_STORE_ID?.trim();
  return {
    ...(token ? { token } : {}),
    ...(storeId ? { storeId } : {}),
  };
}

export function quotationPdfPathname(
  businessNumber: string,
  version: number,
  templateHash: string,
  sourceHash: string,
): string {
  const quote = String(businessNumber || '').trim();
  const hash = String(templateHash || '').trim().toLowerCase();
  const contentHash = String(sourceHash || '').trim().toLowerCase();
  if (!/^ORC-[0-9]{8}$/.test(quote) || !Number.isInteger(version) || version < 1 || !/^[0-9a-f]{64}$/.test(hash) || !/^[0-9a-f]{64}$/.test(contentHash)) {
    throw new QuotationDocumentStorageError('Não foi possível determinar a chave do PDF do orçamento.');
  }
  return `quotations/${quote}/revision-${version}-${hash}-${contentHash}.pdf`;
}

async function streamBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      length += value.byteLength;
    }
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Buffer.from(combined);
}

async function readPrivatePdf(pathname: string, getBlob: typeof get): Promise<StoredQuotationPdf | null> {
  const result = await getBlob(pathname, {
    access: 'private',
    useCache: true,
    ...quotationBlobAuth(),
  });
  if (!result || result.statusCode !== 200) return null;
  const buffer = await streamBuffer(result.stream);
  return {
    pathname: result.blob.pathname,
    buffer,
    contentType: result.blob.contentType,
    sizeBytes: buffer.length,
    checksumSha256: quotationPdfChecksum(buffer),
  };
}

/**
 * Store PDFs with create-only semantics. If an earlier attempt uploaded the
 * deterministic key but failed before the database commit, a retry reuses and
 * verifies that object instead of producing a second Blob or overwriting bytes
 * whose checksum may already have been committed by a concurrent request.
 */
export function createVercelQuotationDocumentStorage(
  blobClient: QuotationBlobClient = { put, get },
): QuotationDocumentStorage {
  return {
    async archive(pathname: string, buffer: Buffer): Promise<ArchivedQuotationPdf> {
      try {
        const blob = await blobClient.put(pathname, buffer, {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: QUOTATION_PDF_MIME_TYPE,
          ...quotationBlobAuth(),
        });
        if (blob.pathname !== pathname) throw new Error('Blob retornou uma chave diferente da solicitada.');
        return {
          pathname,
          sizeBytes: buffer.length,
          checksumSha256: quotationPdfChecksum(buffer),
        };
      } catch (uploadError) {
        try {
          const existing = await readPrivatePdf(pathname, blobClient.get);
          if (existing && isValidPdfBuffer(existing.buffer) && existing.contentType === QUOTATION_PDF_MIME_TYPE) {
            return existing;
          }
        } catch {
          // Preserve the original upload failure; a read miss/failure only
          // proves that there is no reusable orphan from an earlier attempt.
        }
        console.error(`[quotation-document-storage] archive failed (${uploadError instanceof Error ? uploadError.name : typeof uploadError})`);
        throw new QuotationDocumentStorageError();
      }
    },

    async read(pathname: string): Promise<StoredQuotationPdf | null> {
      try {
        return await readPrivatePdf(pathname, blobClient.get);
      } catch (error) {
        console.error(`[quotation-document-storage] read failed (${error instanceof Error ? error.name : typeof error})`);
        throw new QuotationDocumentStorageError('Não foi possível baixar o PDF emitido. Tente novamente.');
      }
    },
  };
}
