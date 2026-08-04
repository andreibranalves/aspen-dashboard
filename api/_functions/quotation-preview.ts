import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import {
  createQuotationTemplateRepository,
  quotationSnapshotViewModel,
  QuotationTemplateSnapshotRepositoryError,
} from '../_db/quotation-template-repository.js';
import {
  getQuotationTemplate,
  renderQuotationTemplate,
  resolveQuotationTemplate,
} from './lib/quotation-templates.js';
import { renderQuotationPdfHtml } from './lib/quotation-pdf.js';
import { isValidPdfBuffer } from './lib/quotation-document-storage.js';
import { isCoreQuotesEnabled } from './orcamento-mode.js';

export interface QuotationPreviewDependencies {
  repository?: ReturnType<typeof createQuotationTemplateRepository>;
}

function json(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}

function safeError(error: unknown): FunctionResult {
  if (error instanceof QuotationTemplateSnapshotRepositoryError) {
    return json(error.statusCode, { error: error.message });
  }
  console.error(
    `[quotation-preview] failed (${error instanceof Error ? error.name : typeof error})`
  );
  return json(503, {
    error: 'Não foi possível gerar a visualização do orçamento. Tente novamente.',
  });
}

export function createQuotationPreviewHandler(
  dependencies: QuotationPreviewDependencies = {}
): LegacyHandler {
  const repository = dependencies.repository || createQuotationTemplateRepository();
  return async function quotationPreviewHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (!isCoreQuotesEnabled()) return json(404, { error: 'Endpoint não encontrado.' });
    if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' });
    const query = event.queryStringParameters || {};
    const id = String(query.id || '').trim();
    if (!id) return json(400, { error: 'ID do orçamento não informado.' });
    const selectedKey = query.template === undefined ? undefined : String(query.template).trim();
    const asPdf = query.format === 'pdf';
    if (selectedKey !== undefined && !getQuotationTemplate(selectedKey)) {
      return json(400, { error: 'Template de orçamento inválido.' });
    }
    try {
      const snapshot = await repository.get(id);
      if (!snapshot) return json(404, { error: 'Orçamento não encontrado.' });
      const template =
        selectedKey === undefined
          ? resolveQuotationTemplate(snapshot.revision.templatePadrao)
          : getQuotationTemplate(selectedKey)!;
      const html = renderQuotationTemplate(template, quotationSnapshotViewModel(snapshot));
      if (asPdf) {
        let pdf: Buffer;
        try {
          pdf = await renderQuotationPdfHtml(html);
        } catch (error) {
          console.error(
            `[quotation-preview] pdf render failed (${error instanceof Error ? error.name : typeof error})`
          );
          return json(503, {
            error: 'Não foi possível gerar o PDF do orçamento. Tente novamente.',
          });
        }
        if (!Buffer.isBuffer(pdf) || !isValidPdfBuffer(pdf)) {
          return json(503, { error: 'O gerador retornou um PDF inválido. Tente novamente.' });
        }
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${snapshot.quotation.businessNumber}.pdf"`,
            'Content-Length': String(pdf.length),
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'X-Quotation-Template-Key': template.key,
            'X-Quotation-Template-Hash': template.hash,
          },
          body: pdf.toString('base64'),
          isBase64Encoded: true,
        };
      }
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Quotation-Template-Key': template.key,
          'X-Quotation-Template-Hash': template.hash,
        },
        body: html,
      };
    } catch (error) {
      return safeError(error);
    }
  };
}

export const handler = createQuotationPreviewHandler();
export const quotationPreviewHandler = handler;
