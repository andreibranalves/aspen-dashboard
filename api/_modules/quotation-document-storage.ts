import { createHash } from 'node:crypto';

export const QUOTATION_PDF_MIME_TYPE = 'application/pdf' as const;
export const QUOTATION_WEBP_MIME_TYPE = 'image/webp' as const;
export const MAX_QUOTATION_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_QUOTATION_WEBP_BYTES = 5 * 1024 * 1024;

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

export const quotationWebpChecksum = quotationPdfChecksum;

export function isValidWebpBuffer(buffer: Buffer): boolean {
  return (
    buffer.length > 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

export function isValidPdfBuffer(buffer: Buffer): boolean {
  return (
    buffer.length > 8 &&
    buffer.subarray(0, 5).toString('ascii') === '%PDF-' &&
    buffer.subarray(Math.max(0, buffer.length - 2048)).includes(Buffer.from('%%EOF'))
  );
}
