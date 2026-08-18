import { createQuotationTemplateRepository, quotationSnapshotViewModel } from '../_db/quotation-template-repository.js';
import {
  formatQuotationClientName,
  quotationTemplateFromVersion,
  renderQuotationTemplate,
  resolveQuotationTemplate,
} from './quotation-template-catalog.js';

export interface RenderQuotationHtmlOptions {
  includePrintButton?: boolean;
  forPdf?: boolean;
  printFormat?: string;
}

export async function renderQuotationHtml(
  quotationId: string,
  opts: RenderQuotationHtmlOptions = {},
): Promise<{ html: string; customerName: string }> {
  const snapshot = await createQuotationTemplateRepository().get(quotationId);
  if (!snapshot) throw Object.assign(new Error('Orçamento não encontrado.'), { statusCode: 404 });

  const template = snapshot.templateVersion
    ? quotationTemplateFromVersion(snapshot.templateVersion)
    : resolveQuotationTemplate(snapshot.revision.templatePadrao, snapshot.revision.templateHash);
  let html = renderQuotationTemplate(template, quotationSnapshotViewModel(snapshot));

  if (opts.includePrintButton !== false && !opts.forPdf) {
    const controls = `<style>#print-btn{position:fixed;top:16px;right:16px;background:#1d2f56;color:#fff;border:0;border-radius:4px;padding:8px 18px;font:700 13px sans-serif;cursor:pointer;z-index:9999}</style><button id="print-btn" onclick="window.print()">Imprimir / Salvar PDF</button>`;
    html = html.includes('</body>')
      ? html.replace('</body>', `${controls}</body>`)
      : `${html}${controls}`;
  }

  return {
    html,
    customerName: formatQuotationClientName(snapshot.revision.clienteNome),
  };
}
