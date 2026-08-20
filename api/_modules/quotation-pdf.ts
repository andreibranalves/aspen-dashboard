import { renderQuotationHtml } from './quotation-html.js';
import { renderQuotationPdfHtml } from './quotation-pdf-renderer.js';

export { renderQuotationPdfHtml } from './quotation-pdf-renderer.js';

export interface GenerateQuotationPdfOptions {
  timeout?: number;
  printFormat?: string;
}

export async function generateQuotationPdf(
  quotationId: string,
  opts: GenerateQuotationPdfOptions = {},
): Promise<{ buffer: Buffer; customerName: string }> {
  const { html, customerName } = await renderQuotationHtml(quotationId, {
    includePrintButton: false,
    forPdf: true,
    printFormat: opts.printFormat,
  });
  return { buffer: await renderQuotationPdfHtml(html, opts), customerName };
}
