import { createHash } from 'node:crypto';

export const QUOTATION_PDF_MIME_TYPE = 'application/pdf' as const;
export const MAX_QUOTATION_PDF_BYTES = 10 * 1024 * 1024;

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
  return (
    buffer.length > 8 &&
    buffer.subarray(0, 5).toString('ascii') === '%PDF-' &&
    buffer.subarray(Math.max(0, buffer.length - 2048)).includes(Buffer.from('%%EOF'))
  );
}

/** @deprecated Blob storage removed (#no-pdf-html-only). Kept for migration reference. */
export function quotationPdfPathname(
  businessNumber: string,
  version: number,
  templateHash: string,
  sourceHash: string
): string {
  const quote = String(businessNumber || '').trim();
  const hash = String(templateHash || '')
    .trim()
    .toLowerCase();
  const contentHash = String(sourceHash || '')
    .trim()
    .toLowerCase();
  if (
    !/^ORC-[0-9]{8}$/.test(quote) ||
    !Number.isInteger(version) ||
    version < 1 ||
    !/^[0-9a-f]{64}$/.test(hash) ||
    !/^[0-9a-f]{64}$/.test(contentHash)
  ) {
    throw new QuotationDocumentStorageError(
      'Não foi possível determinar a chave do PDF do orçamento.'
    );
  }
  return `quotations/${quote}/revision-${version}-${hash}-${contentHash}.pdf`;
}
