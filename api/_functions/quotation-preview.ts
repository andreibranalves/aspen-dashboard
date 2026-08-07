import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import {
  createQuotationTemplateRepository,
  quotationSnapshotViewModel,
  QuotationTemplateSnapshotRepositoryError,
} from '../_db/quotation-template-repository.js';
import {
  quotationTemplateFromVersion,
  QuotationTemplateResolutionError,
  renderQuotationTemplate,
  resolveQuotationTemplate,
} from './lib/quotation-templates.js';
import { renderQuotationPdfHtml } from './lib/quotation-pdf-renderer.js';
import { isValidPdfBuffer } from './lib/quotation-document-storage.js';
import { isCoreReadEnabled } from './orcamento-mode.js';

export interface QuotationPreviewDependencies {
  repository?: {
    get(
      id: string,
      templateVersionId?: string
    ): ReturnType<ReturnType<typeof createQuotationTemplateRepository>['get']>;
  };
  renderPdf?: (html: string) => Promise<Buffer>;
}

const HTML_SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:; script-src 'none'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function json(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}

function safeError(error: unknown): FunctionResult {
  if (
    error instanceof QuotationTemplateSnapshotRepositoryError ||
    error instanceof QuotationTemplateResolutionError
  ) {
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
  const renderPdf = dependencies.renderPdf || renderQuotationPdfHtml;
  return async function quotationPreviewHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (!isCoreReadEnabled()) return json(404, { error: 'Endpoint não encontrado.' });
    if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' });
    const query = event.queryStringParameters || {};
    const id = String(query.id || '').trim();
    if (!id) return json(400, { error: 'ID do orçamento não informado.' });
    if (query.template !== undefined || query.template_key !== undefined) {
      return json(400, { error: 'Sobrescrita de template não permitida.' });
    }
    const selectedVersionId =
      query.template_version_id === undefined
        ? undefined
        : String(query.template_version_id).trim();
    const asPdf = query.format === 'pdf';
    try {
      const snapshot = await repository.get(id, selectedVersionId);
      if (!snapshot) return json(404, { error: 'Orçamento não encontrado.' });
      const template = snapshot.templateVersion
        ? quotationTemplateFromVersion(snapshot.templateVersion)
        : resolveQuotationTemplate(snapshot.revision.templatePadrao, snapshot.revision.templateHash);
      const html = renderQuotationTemplate(template, quotationSnapshotViewModel(snapshot));
      if (asPdf) {
        let pdf: Buffer;
        try {
          pdf = await renderPdf(html);
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
            'X-Quotation-Template-Version': snapshot.templateVersion
              ? String(snapshot.templateVersion.version)
              : 'legacy',
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
          ...HTML_SECURITY_HEADERS,
          'X-Quotation-Template-Key': template.key,
          'X-Quotation-Template-Version': snapshot.templateVersion
            ? String(snapshot.templateVersion.version)
            : 'legacy',
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
