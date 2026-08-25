import { renderQuotationHtml, type RenderQuotationHtmlOptions } from './quotation-html.js';
import { renderQuotationPdfHtml } from './quotation-pdf-renderer.js';

export type QuotationPdfRenderer = typeof renderQuotationPdfHtml;

export { renderQuotationPdfHtml } from './quotation-pdf-renderer.js';

export interface GenerateQuotationPdfOptions extends Pick<
  RenderQuotationHtmlOptions,
  'repository' | 'renderDocument'
> {
  timeout?: number;
  printFormat?: string;
  renderPdf?: QuotationPdfRenderer;
}

export async function generateQuotationPdf(
  quotationId: string,
  opts: GenerateQuotationPdfOptions = {}
): Promise<{ buffer: Buffer; customerName: string }> {
  const { html, customerName } = await renderQuotationHtml(quotationId, {
    includePrintButton: false,
    forPdf: true,
    printFormat: opts.printFormat,
    repository: opts.repository,
    renderDocument: opts.renderDocument,
  });
  return { buffer: await (opts.renderPdf || renderQuotationPdfHtml)(html, opts), customerName };
}
