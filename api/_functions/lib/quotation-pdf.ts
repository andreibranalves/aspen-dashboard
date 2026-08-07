// Legacy quotation PDF generation.
// ERPNext printview is loaded only when this legacy entry point is called.

import { resolvePrintFormat } from './print-format.js';
import { renderQuotationPdfHtml } from './quotation-pdf-renderer.js';

export { renderQuotationPdfHtml } from './quotation-pdf-renderer.js';

export interface GenerateQuotationPdfOptions {
  timeout?: number;
  printFormat?: string;
}

export async function generateQuotationPdf(
  quotationId: string,
  opts: GenerateQuotationPdfOptions = {}
): Promise<{ buffer: Buffer; customerName: string }> {
  const printFormat = await resolvePrintFormat(quotationId, opts.printFormat);
  // Keep ERPNext printview outside the core/public PDF import path.
  const { renderQuotationHtml } = await import('./quotation-html.js');
  const { html, customerName } = await renderQuotationHtml(quotationId, {
    includePrintButton: false,
    forPdf: true,
    printFormat,
  });

  return { buffer: await renderQuotationPdfHtml(html, opts), customerName };
}
